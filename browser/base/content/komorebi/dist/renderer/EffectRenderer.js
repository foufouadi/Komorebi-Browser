/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { Matrix4 } from "../math/Matrix4.js";
import { compileProperty, sampleProperty, } from "../effects/AnimatedProperty.js";
import { currentFrame } from "../graphics/SpriteFrame.js";
const IDENTITY_MATRIX = Matrix4.identity().values;
const TEXTURE_SLOTS = 8;
const TEXTURE_SAMPLER_NAMES = Array.from({ length: TEXTURE_SLOTS }, (_, index) => `g_Texture${index}`);
const TEXTURE_RESOLUTION_NAMES = TEXTURE_SAMPLER_NAMES.map(name => `${name}Resolution`);
const TEXTURE_UNIFORM = /^g_Texture\d+(?:Resolution)?$/;
const MATRIX_UNIFORMS = [
    "g_ModelViewProjectionMatrix",
    "g_EffectModelViewProjectionMatrix",
    "g_ModelMatrix",
    "g_EffectModelMatrix",
];
// The same quad as the pixel-space one, after the orthographic projection.
const CLIP_QUAD = new Float32Array([-1, 1, 0, 1, 1, 0, -1, -1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0]);
export class EffectRenderer {
    #graphics;
    #animatedValues = new WeakMap();
    #activePasses = new WeakMap();
    #parsedStrings = new Map();
    #uniformPlans = new WeakMap();
    #targetStates = new WeakMap();
    #lastElapsed = new WeakMap();
    #matrixPasses = new WeakMap();
    #frametime = 1 / 60;
    #blackTexture = null;
    #targetPool = new Map();
    #copyPositionBuffer;
    #copyTexCoordBuffer;
    constructor(graphics) {
        this.#graphics = graphics;
        const buffer = graphics.gl.createBuffer();
        if (!buffer) {
            throw new Error("Failed to create effect copy position buffer");
        }
        this.#copyPositionBuffer = buffer;
        const texCoordBuffer = graphics.gl.createBuffer();
        if (!texCoordBuffer) {
            throw new Error("Failed to create effect copy texcoord buffer");
        }
        this.#copyTexCoordBuffer = texCoordBuffer;
    }
    // `input` replaces the layer's own texture: a composition layer filters the scene captured so far.
    run(layer, elapsed, pointer, projection, input = null) {
        const passes = this.#passesOf(layer);
        if (!passes.length) {
            return layer.glTexture;
        }
        const gl = this.#graphics.gl;
        const last = this.#lastElapsed.get(layer);
        this.#frametime = last === undefined ? 1 / 60 : Math.min(0.1, Math.max(0, elapsed - last));
        this.#lastElapsed.set(layer, elapsed);
        // Named targets outlive a frame: simulation effects (cursor ripples) read the buffer their last pass wrote on the previous frame.
        let state = this.#targetStates.get(layer);
        if (!state) {
            state = {
                targets: new Map(),
                written: new Set(passes.map(pass => pass.target).filter(Boolean)),
            };
            this.#targetStates.set(layer, state);
        }
        const { targets, written } = state;
        let previous = input
            ? {
                texture: input,
                width: layer.width,
                height: layer.height,
                textureWidth: layer.width,
                textureHeight: layer.height,
            }
            : this.#renderTexture(layer);
        const sheetFrame = layer.imageTextures ? currentFrame(layer.frames, elapsed * 1000, 0) : null;
        if (sheetFrame?.imageIndex) {
            previous.texture = layer.imageTextures[sheetFrame.imageIndex] ?? previous.texture;
        }
        // Snapshot of `previous` before each WE effect's own pass chain starts, used by binds that never get an explicit target (e.g. "_rt_imageLayerComposite_<id>_a/_b").
        let effectInput = previous;
        for (let passIndex = 0; passIndex < passes.length; passIndex++) {
            const pass = passes[passIndex];
            if (pass.effectPassIndex === 0) {
                effectInput = previous;
            }
            const firstPass = passIndex === 0;
            const outputWidth = pass.outputWidth ?? layer.width;
            const outputHeight = pass.outputHeight ?? layer.height;
            const lent = pass.pooled
                ? this.#lendTarget(outputWidth, outputHeight, previous.texture, effectInput.texture)
                : null;
            const framebuffer = lent?.framebuffer ?? pass.framebuffer ?? null;
            const outputTexture = lent?.texture ?? pass.outputTexture;
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.viewport(0, 0, outputWidth, outputHeight);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(pass.program ?? null);
            this.#setPassState(pass, framebuffer);
            const positionBuffer = firstPass
                ? (layer.puppetEffectPositionBuffer ??
                    this.#prepareCopyPositionBuffer(layer.width, layer.height, Boolean(layer.text) && !this.#usesMatrix(pass)))
                : this.#graphics.screenQuad.positionBuffer;
            this.#bindPassAttribute(pass.program, "a_Position", positionBuffer, 3);
            const texCoordBuffer = firstPass && layer.puppetTexCoordBuffer
                ? layer.puppetTexCoordBuffer
                : firstPass
                    ? this.#prepareCopyTexCoordBuffer(layer.u, layer.v)
                    : this.#graphics.screenQuad.texCoordBuffer;
            this.#bindPassAttribute(pass.program, "a_TexCoord", texCoordBuffer, 2);
            for (let index = 0; index < TEXTURE_SLOTS; index++) {
                const bind = pass.binds[index] ?? pass.binds[String(index)];
                // A named bind not yet registered in `targets` falls back to `effectInput`, not the live `previous`.
                const source = bind === "previous"
                    ? previous
                    : bind !== undefined
                        ? (targets.get(bind) ?? (written.has(bind) ? this.#emptyTexture() : effectInput))
                        : (this.#resolvedTexture(pass.resolvedTextures?.get(index)) ??
                            (index === 0 ? previous : this.#whiteTexture()));
                gl.activeTexture(gl.TEXTURE0 + index);
                gl.bindTexture(gl.TEXTURE_2D, source.texture);
                const sampler = this.#graphics.uniform(pass.program, TEXTURE_SAMPLER_NAMES[index]);
                if (sampler !== null) {
                    gl.uniform1i(sampler, index);
                }
                const resolution = this.#graphics.uniform(pass.program, TEXTURE_RESOLUTION_NAMES[index]);
                if (resolution !== null) {
                    gl.uniform4f(resolution, source.textureWidth, source.textureHeight, source.width, source.height);
                }
            }
            this.#setPassUniforms(pass, layer, elapsed, pointer, projection, firstPass);
            if (firstPass && layer.puppetIndexBuffer) {
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.puppetIndexBuffer);
                gl.drawElements(gl.TRIANGLES, layer.puppetIndexCount ?? 0, gl.UNSIGNED_SHORT, 0);
            }
            else {
                gl.drawArrays(gl.TRIANGLES, 0, 6);
            }
            if (outputTexture) {
                const output = {
                    texture: outputTexture,
                    width: outputWidth,
                    height: outputHeight,
                    textureWidth: outputWidth,
                    textureHeight: outputHeight,
                };
                // A pass that renders into a named target leaves the image flow alone: "previous" keeps meaning the last untargeted result (godrays' final pass blends its rays onto it).
                if (pass.target) {
                    targets.set(pass.target, output);
                }
                else {
                    previous = output;
                }
            }
        }
        gl.depthMask(true);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        return previous.texture;
    }
    // layer.u/layer.v are the valid fraction of a texture padded to a larger GPU allocation (NPOT .tex uploads); only the first pass needs this, later passes read this engine's own unpadded pass outputs.
    #prepareCopyTexCoordBuffer(u, v) {
        const gl = this.#graphics.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#copyTexCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, v, u, v, 0, 0, 0, 0, u, v, u, 0]), gl.STREAM_DRAW);
        return this.#copyTexCoordBuffer;
    }
    // Only text layers take this for now: on image layers it removes the partial-quad artifacts but leaves some areas black, which is still unexplained.
    // A first pass whose vertex shader ignores the projection matrices (a custom blur that writes a_Position straight to gl_Position) needs the quad already in clip space.
    #usesMatrix(pass) {
        let uses = this.#matrixPasses.get(pass);
        if (uses === undefined) {
            uses = MATRIX_UNIFORMS.some(name => this.#graphics.uniform(pass.program, name) !== null);
            this.#matrixPasses.set(pass, uses);
        }
        return uses;
    }
    #prepareCopyPositionBuffer(width, height, clipSpace = false) {
        const gl = this.#graphics.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#copyPositionBuffer);
        if (clipSpace) {
            gl.bufferData(gl.ARRAY_BUFFER, CLIP_QUAD, gl.STREAM_DRAW);
            return this.#copyPositionBuffer;
        }
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0,
            height,
            0,
            width,
            height,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            width,
            height,
            0,
            width,
            0,
            0,
        ]), gl.STREAM_DRAW);
        return this.#copyPositionBuffer;
    }
    #renderTexture(texture) {
        return {
            texture: texture.glTexture,
            width: texture.width,
            height: texture.height,
            textureWidth: texture.textureWidth,
            textureHeight: texture.textureHeight,
        };
    }
    #resolvedTexture(texture) {
        return texture ? this.#renderTexture(texture) : undefined;
    }
    // Never-written simulation state starts out as transparent black.
    #emptyTexture() {
        const gl = this.#graphics.gl;
        if (!this.#blackTexture) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            this.#blackTexture = {
                texture,
                width: 1,
                height: 1,
                textureWidth: 1,
                textureHeight: 1,
            };
        }
        return this.#blackTexture;
    }
    #whiteTexture() {
        return {
            texture: this.#graphics.whiteTexture,
            width: 1,
            height: 1,
            textureWidth: 1,
            textureHeight: 1,
        };
    }
    releaseTargets() {
        const gl = this.#graphics.gl;
        for (const targets of this.#targetPool.values()) {
            for (const { texture, framebuffer } of targets) {
                gl.deleteTexture(texture);
                gl.deleteFramebuffer(framebuffer);
            }
        }
        this.#targetPool.clear();
    }
    /**
     * A pooled target of the given size that holds neither `busy` texture: the chain may still read the previous result and the input of the current effect.
     */
    #lendTarget(width, height, ...busy) {
        const key = width + "x" + height;
        let targets = this.#targetPool.get(key);
        if (!targets) {
            targets = [];
            this.#targetPool.set(key, targets);
        }
        const free = targets.find(target => !busy.includes(target.texture));
        if (free) {
            return free;
        }
        const gl = this.#graphics.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        const target = { texture, framebuffer };
        targets.push(target);
        return target;
    }
    #setPassState(pass, framebuffer) {
        const gl = this.#graphics.gl;
        if (pass.blending === "additive") {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.SRC_ALPHA, gl.ONE);
        }
        // Blending onto a freshly cleared intermediate target would apply alpha twice: once here, once when the layer is composited.
        else if (pass.blending === "translucent" && !framebuffer) {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        else {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
        }
        pass.depthtest ? gl.enable(gl.DEPTH_TEST) : gl.disable(gl.DEPTH_TEST);
        pass.cullmode === "normal"
            ? gl.enable(gl.CULL_FACE)
            : gl.disable(gl.CULL_FACE);
        gl.depthMask(pass.depthwrite);
    }
    #bindPassAttribute(program, name, buffer, size) {
        const gl = this.#graphics.gl;
        const location = this.#graphics.attrib(program, name);
        if (location < 0) {
            return;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
    #setPassUniforms(pass, layer, elapsed, pointer, projection, firstPass) {
        const gl = this.#graphics.gl;
        const frame = currentFrame(layer.frames, elapsed * 1000, 0);
        for (const { name, metadata, location } of this.#uniformPlan(pass)) {
            if (metadata.type === "mat4") {
                const matrix = this.#matrixUniform(name, layer, firstPass);
                gl.uniformMatrix4fv(location, false, matrix);
                continue;
            }
            let value;
            if (name === "g_Time")
                value = elapsed;
            else if (name === "g_Frametime")
                value = this.#frametime;
            else if (name === "g_Daytime")
                value = elapsed;
            else if (name === "g_PointerPosition")
                value = pointer;
            else if (name === "g_PointerPositionLast")
                value = pointer;
            else if (name === "g_TexelSize")
                value = [1 / projection[0], 1 / projection[1]];
            else if (name === "g_TexelSizeHalf")
                value = [0.5 / projection[0], 0.5 / projection[1]];
            else if (name === "g_TextureReductionScale")
                value = 1;
            else if (name === "g_Texture0Translation")
                value = frame?.translation ?? [0, 0];
            else if (name === "g_Texture0Rotation") {
                value = frame?.rotation ?? [1, 0, 0, 1];
            }
            else if (name === "g_Brightness" || name === "g_UserAlpha")
                value = 1;
            else if (name === "g_Alpha") {
                // An effect's own "alpha" setting wins; the layer's opacity is what applies otherwise.
                const key = metadata.configuration?.material;
                value = (key === undefined ? undefined : pass.constants[key]) ?? layer.opacity;
            }
            else if (name === "g_Color")
                value = layer.tint;
            else if (name === "g_Color4")
                value = [...layer.tint, 1];
            else if (name === "g_CompositeColor")
                value = [1, 1, 1];
            else {
                const key = metadata.configuration?.material;
                const label = metadata.configuration?.label;
                value = pass.constants[name];
                value ??= key === undefined ? undefined : pass.constants[key];
                // Older WE editor exports key constantshadervalues by the uniform's UI label instead of its "material" key.
                value ??= label === undefined ? undefined : pass.constants[label];
                value ??= metadata.configuration?.default;
            }
            this.#setPassUniform(location, metadata.type, this.#sampleValue(value, metadata.type, elapsed));
        }
    }
    #passesOf(layer) {
        const source = layer.renderPasses;
        let cached = this.#activePasses.get(layer);
        if (!cached || cached.source !== source || cached.length !== source.length) {
            cached = {
                source,
                length: source.length,
                passes: source.filter(pass => pass.program),
            };
            this.#activePasses.set(layer, cached);
        }
        return cached.passes;
    }
    #uniformPlan(pass) {
        let plan = this.#uniformPlans.get(pass);
        if (!plan) {
            plan = [];
            for (const [name, metadata] of pass.uniforms) {
                const location = this.#graphics.uniform(pass.program, name);
                if (location !== null && !TEXTURE_UNIFORM.test(name)) {
                    plan.push({ name, metadata, location });
                }
            }
            this.#uniformPlans.set(pass, plan);
        }
        return plan;
    }
    #parseNumbers(text) {
        let numbers = this.#parsedStrings.get(text);
        if (!numbers) {
            numbers = text.trim().split(/\s+/).map(Number);
            if (this.#parsedStrings.size > 512) {
                this.#parsedStrings.clear();
            }
            this.#parsedStrings.set(text, numbers);
        }
        return numbers;
    }
    #matrixUniform(name, layer, firstPass) {
        if (name === "g_ModelViewProjectionMatrixInverse") {
            return firstPass
                ? Matrix4.inverseOrthographic(layer.width, layer.height).values
                : IDENTITY_MATRIX;
        }
        if (name === "g_ModelViewProjectionMatrix" ||
            name === "g_EffectModelViewProjectionMatrix" ||
            name === "g_ModelMatrix" ||
            name === "g_EffectModelMatrix") {
            return firstPass
                ? Matrix4.orthographic(layer.width, layer.height).values
                : name.includes("ModelMatrix")
                    ? Matrix4.orthographic(layer.width, layer.height).values
                    : IDENTITY_MATRIX;
        }
        return IDENTITY_MATRIX;
    }
    #sampleValue(source, type, elapsed) {
        if (source === null ||
            typeof source !== "object" ||
            !("animation" in source)) {
            return source;
        }
        let property = this.#animatedValues.get(source);
        if (!property) {
            const dimensions = type === "vec4" ? 4 : type === "vec3" ? 3 : type === "vec2" ? 2 : 1;
            property = compileProperty(source, dimensions === 1 ? 0 : Array(dimensions).fill(0));
            this.#animatedValues.set(source, property);
        }
        return sampleProperty(property, elapsed);
    }
    #setPassUniform(location, type, source) {
        if (source === undefined || source === null) {
            return;
        }
        const value = source !== null && typeof source === "object" && "value" in source
            ? (source.value ?? source)
            : source;
        const values = Array.isArray(value)
            ? value.map(Number)
            : typeof value === "string"
                ? this.#parseNumbers(value)
                : [Number(value)];
        const gl = this.#graphics.gl;
        if (type === "float")
            gl.uniform1f(location, values[0]);
        else if (type === "int" || type === "bool")
            gl.uniform1i(location, values[0]);
        else if (type === "vec2")
            gl.uniform2fv(location, values);
        else if (type === "vec3")
            gl.uniform3fv(location, values);
        else if (type === "vec4")
            gl.uniform4fv(location, values);
    }
}
