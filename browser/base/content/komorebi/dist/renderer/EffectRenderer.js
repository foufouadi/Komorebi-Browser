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
export class EffectRenderer {
    #graphics;
    #animatedValues = new WeakMap();
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
    run(layer, elapsed, pointer, projection) {
        const passes = layer.renderPasses.filter(pass => pass.program);
        if (!passes.length) {
            return layer.glTexture;
        }
        const gl = this.#graphics.gl;
        const targets = new Map();
        let previous = this.#renderTexture(layer);
        // Snapshot of `previous` before each WE effect's own pass chain starts, used by binds that never get an explicit target (e.g. "_rt_imageLayerComposite_<id>_a/_b").
        let effectInput = previous;
        for (let passIndex = 0; passIndex < passes.length; passIndex++) {
            const pass = passes[passIndex];
            if (pass.effectPassIndex === 0) {
                effectInput = previous;
            }
            const firstPass = passIndex === 0;
            gl.bindFramebuffer(gl.FRAMEBUFFER, pass.framebuffer ?? null);
            gl.viewport(0, 0, pass.outputWidth ?? layer.width, pass.outputHeight ?? layer.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(pass.program ?? null);
            this.#setPassState(pass);
            const positionBuffer = firstPass
                ? (layer.puppetEffectPositionBuffer ??
                    this.#prepareCopyPositionBuffer(layer.width, layer.height))
                : this.#graphics.screenQuad.positionBuffer;
            this.#bindPassAttribute(pass.program, "a_Position", positionBuffer, 3);
            const texCoordBuffer = firstPass && layer.puppetTexCoordBuffer
                ? layer.puppetTexCoordBuffer
                : firstPass
                    ? this.#prepareCopyTexCoordBuffer(layer.u, layer.v)
                    : this.#graphics.screenQuad.texCoordBuffer;
            this.#bindPassAttribute(pass.program, "a_TexCoord", texCoordBuffer, 2);
            for (let index = 0; index < 8; index++) {
                const bind = pass.binds[index] ?? pass.binds[String(index)];
                // A named bind not yet registered in `targets` falls back to `effectInput`, not the live `previous`.
                const source = bind === "previous"
                    ? previous
                    : bind !== undefined
                        ? (targets.get(bind) ?? effectInput)
                        : (this.#resolvedTexture(pass.resolvedTextures?.get(index)) ??
                            (index === 0 ? previous : this.#whiteTexture()));
                gl.activeTexture(gl.TEXTURE0 + index);
                gl.bindTexture(gl.TEXTURE_2D, source.texture);
                const sampler = gl.getUniformLocation(pass.program, `g_Texture${index}`);
                if (sampler !== null) {
                    gl.uniform1i(sampler, index);
                }
                const resolution = gl.getUniformLocation(pass.program, `g_Texture${index}Resolution`);
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
            if (pass.outputTexture) {
                previous = {
                    texture: pass.outputTexture,
                    width: pass.outputWidth ?? layer.width,
                    height: pass.outputHeight ?? layer.height,
                    textureWidth: pass.outputWidth ?? layer.width,
                    textureHeight: pass.outputHeight ?? layer.height,
                };
            }
            if (pass.target) {
                targets.set(pass.target, previous);
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
    #prepareCopyPositionBuffer(width, height) {
        const gl = this.#graphics.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#copyPositionBuffer);
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
    #whiteTexture() {
        return {
            texture: this.#graphics.whiteTexture,
            width: 1,
            height: 1,
            textureWidth: 1,
            textureHeight: 1,
        };
    }
    #setPassState(pass) {
        const gl = this.#graphics.gl;
        if (pass.blending === "additive") {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.SRC_ALPHA, gl.ONE);
        }
        else if (pass.blending === "translucent") {
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
        const location = gl.getAttribLocation(program, name);
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
        for (const [name, metadata] of pass.uniforms) {
            const location = gl.getUniformLocation(pass.program, name);
            if (location === null || /^g_Texture\d+(?:Resolution)?$/.test(name)) {
                continue;
            }
            if (metadata.type === "mat4") {
                const matrix = this.#matrixUniform(name, layer, firstPass);
                gl.uniformMatrix4fv(location, false, matrix);
                continue;
            }
            let value;
            if (name === "g_Time")
                value = elapsed;
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
            else if (name === "g_Alpha")
                value = layer.opacity;
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
                ? value.trim().split(/\s+/).map(Number)
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
