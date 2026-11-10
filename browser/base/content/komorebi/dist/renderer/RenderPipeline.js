/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { SCENE_VERTEX_SHADER } from "../graphics/shaders/SceneVertexShader.js";
import { SCENE_FRAGMENT_SHADER } from "../graphics/shaders/SceneFragmentShader.js";
import { SCENE_BLEND_FRAGMENT_SHADER } from "../graphics/shaders/SceneBlendFragmentShader.js";
import { EffectRenderer } from "./EffectRenderer.js";
import { LayerRenderer } from "./LayerRenderer.js";
import { ParticleRenderer } from "./ParticleRenderer.js";
import { EffectCompiler } from "../effects/EffectCompiler.js";
export function computeSceneScale(fit, screenRatio, sceneRatio) {
    if (fit === "stretch") {
        return [1, 1];
    }
    const sceneIsWider = sceneRatio > screenRatio;
    const wide = sceneRatio / screenRatio;
    const tall = screenRatio / sceneRatio;
    if (fit === "contain") {
        return sceneIsWider ? [1, tall] : [wide, 1];
    }
    return sceneIsWider ? [wide, 1] : [1, tall];
}
// Camera parallax: a layer of depth 1 moves by this fraction of the scene width when the pointer sits at the edge, per unit of amount x influence.
const PARALLAX_REACH = 0.1;
// Camera shake: scene widths of travel per unit of amplitude.
const SHAKE_REACH = 0.01;
const NO_CAMERA = { x: 0, y: 0, zoom: 1 };
function shakeNoise(time) {
    return (Math.sin(time * 2.1) + Math.sin(time * 3.7 + 1.3) + Math.sin(time * 5.3 + 2.1)) / 3;
}
export class RenderPipeline {
    #blendProgram = null;
    #blendScenes = new WeakMap();
    #camera = { x: 0, y: 0, lastTimestamp: 0 };
    #graphics;
    #canvasViewport;
    #effectsEnabled = true;
    #fit = "cover";
    #program;
    #layerRenderer;
    #effectRenderer;
    #particleRenderer;
    #pointer = [0.5, 0.5];
    #pointerTimestamp = 0;
    #capture = null;
    constructor(graphics, canvasViewport) {
        this.#graphics = graphics;
        this.#canvasViewport = canvasViewport;
        this.#program = graphics.programs.get(SCENE_VERTEX_SHADER, SCENE_FRAGMENT_SHADER);
        this.#effectRenderer = new EffectRenderer(graphics);
        this.#layerRenderer = new LayerRenderer(graphics, this.#program);
        this.#particleRenderer = new ParticleRenderer(graphics);
    }
    setEffectsEnabled(enabled) {
        this.#effectsEnabled = enabled;
    }
    setFit(fit) {
        this.#fit = fit;
    }
    // Where the pointer sits in scene units as a fraction (origin bottom-left), or null while it is unknown.
    cursorToScene(projection) {
        const tracker = MousePosTracker;
        const x = Number(tracker?._x);
        const y = Number(tracker?._y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return null;
        }
        const { height, left, top, width } = this.#canvasViewport.bounds;
        const screenX = (x - left) / width;
        const screenY = (y - top) / height;
        if (screenX < 0 || screenX > 1 || screenY < 0 || screenY > 1) {
            return null;
        }
        const scale = computeSceneScale(this.#fit, width / height, projection[0] / projection[1]);
        return [0.5 + (screenX - 0.5) / scale[0], 0.5 + (0.5 - screenY) / scale[1]];
    }
    render(layers, particles, projection, timestamp, animationStart, pointerTimestamp = timestamp, clearColor = null, options = null) {
        if (!layers.length || this.#canvasViewport.canvas.hidden) {
            return;
        }
        const gl = this.#graphics.gl;
        const { width, height } = this.#canvasViewport.syncDrawingBufferSize();
        gl.viewport(0, 0, width, height);
        gl.clearColor(clearColor?.[0] ?? 0, clearColor?.[1] ?? 0, clearColor?.[2] ?? 0, clearColor ? 1 : 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.#program);
        gl.enable(gl.BLEND);
        const screenRatio = width / height;
        const sceneRatio = projection[0] / projection[1];
        const sceneScale = computeSceneScale(this.#fit, screenRatio, sceneRatio);
        const graphics = this.#graphics;
        let camera = NO_CAMERA;
        gl.uniform2f(graphics.uniform(this.#program, "uProjection"), projection[0], projection[1]);
        gl.uniform2f(graphics.uniform(this.#program, "uSceneScale"), sceneScale[0], sceneScale[1]);
        gl.uniform1f(graphics.uniform(this.#program, "uFlipY"), 1);
        const elapsed = (timestamp - animationStart) / 1000;
        gl.uniform1f(graphics.uniform(this.#program, "uTime"), elapsed);
        const pointer = this.#samplePointer(pointerTimestamp);
        if (options?.camera && (options.camera.parallax || options.camera.shake)) {
            camera = this.#cameraOffset(options.camera, projection, pointer, timestamp);
            sceneScale[0] *= camera.zoom;
            sceneScale[1] *= camera.zoom;
            gl.uniform2f(graphics.uniform(this.#program, "uSceneScale"), sceneScale[0], sceneScale[1]);
        }
        const timing = { elapsed, timestamp, animationStart, cameraX: camera.x, cameraY: camera.y };
        // Composition layers filter everything drawn below them, so such a scene is drawn off-screen first.
        const compositionLayer = this.#effectsEnabled
            ? layers.find(layer => !layer.hidden && layer.passthrough && layer.renderPasses.some(pass => pass.program))
            : undefined;
        // Blend modes read what is already drawn, so such a scene is drawn off-screen too.
        const capture = compositionLayer || this.#hasBlend(layers)
            ? this.#captureTarget(compositionLayer ? [compositionLayer.width, compositionLayer.height] : (options?.captureSize ?? [width, height]), projection)
            : null;
        if (capture) {
            this.#beginCapture(capture, clearColor);
        }
        for (const layer of layers) {
            if (layer.hidden || (layer.passthrough && !compositionLayer)) {
                continue;
            }
            this.#layerRenderer.updateVideoTexture(layer);
            const sourceTexture = layer.passthrough
                ? this.#effectRenderer.run(layer, elapsed, pointer, projection, capture.texture)
                : this.#effectsEnabled
                    ? this.#effectRenderer.run(layer, elapsed, pointer, projection)
                    : layer.glTexture;
            gl.bindFramebuffer(gl.FRAMEBUFFER, capture ? capture.framebuffer : null);
            gl.viewport(0, 0, capture ? capture.width : width, capture ? capture.height : height);
            gl.useProgram(this.#program);
            if (layer.blendMode > 0 && !layer.passthrough && capture) {
                this.#drawBlended(layer, sourceTexture, timing, capture, projection);
            }
            else {
                this.#layerRenderer.draw(layer.passthrough ? capture.layer : layer, sourceTexture, timing);
            }
        }
        if (capture) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, width, height);
            gl.useProgram(this.#program);
            gl.uniform2f(graphics.uniform(this.#program, "uSceneScale"), sceneScale[0], sceneScale[1]);
            gl.uniform1f(graphics.uniform(this.#program, "uFlipY"), 1);
            this.#layerRenderer.draw(capture.layer, capture.texture, timing);
        }
        this.#particleRenderer.draw(particles, {
            timestamp,
            height,
            projection,
            sceneScale,
            animationStart,
        });
        gl.useProgram(this.#program);
    }
    // The off-screen copy keeps the texture convention of everything else (top row first), hence the Y flip while drawing into it.
    #beginCapture(capture, clearColor) {
        const gl = this.#graphics.gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, capture.framebuffer);
        gl.viewport(0, 0, capture.width, capture.height);
        gl.clearColor(clearColor?.[0] ?? 0, clearColor?.[1] ?? 0, clearColor?.[2] ?? 0, clearColor ? 1 : 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(this.#program);
        gl.uniform2f(this.#graphics.uniform(this.#program, "uSceneScale"), 1, 1);
        gl.uniform1f(this.#graphics.uniform(this.#program, "uFlipY"), -1);
    }
    #hasBlend(layers) {
        let blends = this.#blendScenes.get(layers);
        if (blends === undefined) {
            blends = layers.some(layer => layer.blendMode > 0 && !layer.passthrough);
            this.#blendScenes.set(layers, blends);
        }
        return blends;
    }
    // Draws a layer whose colour is blended with what is below it: the capture so far is copied aside, and the layer's shader reads that copy.
    #drawBlended(layer, sourceTexture, timing, capture, projection) {
        const gl = this.#graphics.gl;
        const graphics = this.#graphics;
        const program = (this.#blendProgram ??= graphics.programs.get(SCENE_VERTEX_SHADER, SCENE_BLEND_FRAGMENT_SHADER));
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, capture.backdrop);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, capture.width, capture.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.useProgram(program);
        gl.uniform2f(graphics.uniform(program, "uProjection"), projection[0], projection[1]);
        gl.uniform2f(graphics.uniform(program, "uSceneScale"), 1, 1);
        gl.uniform1f(graphics.uniform(program, "uFlipY"), -1);
        gl.uniform1f(graphics.uniform(program, "uTime"), timing.elapsed);
        gl.uniform1i(graphics.uniform(program, "uBackdrop"), 1);
        gl.uniform2f(graphics.uniform(program, "uBackdropSize"), capture.width, capture.height);
        gl.uniform1i(graphics.uniform(program, "uBlendMode"), layer.blendMode);
        gl.disable(gl.BLEND);
        this.#layerRenderer.draw(layer, sourceTexture, timing, program);
        gl.enable(gl.BLEND);
        gl.useProgram(this.#program);
    }
    #cameraOffset(settings, projection, pointer, timestamp) {
        const state = this.#camera;
        const seconds = timestamp / 1000;
        const step = state.lastTimestamp ? Math.min(0.1, Math.max(0, seconds - state.lastTimestamp)) : 0;
        state.lastTimestamp = seconds;
        const width = projection[0];
        let x = 0;
        let y = 0;
        let reach = 0;
        const { parallax, shake } = settings;
        if (parallax) {
            const factor = parallax.delay > 0 ? 1 - Math.exp(-step / parallax.delay) : 1;
            state.x += ((pointer[0] - 0.5) * 2 - state.x) * factor;
            state.y += ((pointer[1] - 0.5) * 2 - state.y) * factor;
            const scale = parallax.amount * parallax.influence * PARALLAX_REACH * width;
            // The camera follows the pointer, so what sits in front slides the other way.
            x = -state.x * scale;
            y = -state.y * scale;
            reach += Math.abs(parallax.amount * parallax.influence) * PARALLAX_REACH * (settings.maxDepth ?? 1);
        }
        if (shake) {
            const travel = shake.amplitude * SHAKE_REACH * width;
            const time = seconds * shake.speed;
            const rough = 1 + shake.roughness * 0.5;
            x += shakeNoise(time) * travel;
            y += shakeNoise(time * rough + 17.3) * travel;
            reach += Math.abs(shake.amplitude) * SHAKE_REACH;
        }
        // Moving the layers would show the scene's edges; zooming in by what they can travel hides them.
        return { x, y, zoom: 1 + 2 * reach };
    }
    #captureTarget(size, projection) {
        const gl = this.#graphics.gl;
        let capture = this.#capture;
        if (capture && (capture.width !== size[0] || capture.height !== size[1])) {
            gl.deleteTexture(capture.texture);
            gl.deleteTexture(capture.backdrop);
            gl.deleteFramebuffer(capture.framebuffer);
            capture = null;
        }
        if (!capture) {
            const texture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size[0], size[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            const framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            // The copy a blend mode reads; only blend scenes ever write to it.
            const backdrop = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, backdrop);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size[0], size[1], 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            capture = {
                backdrop,
                framebuffer,
                height: size[1],
                texture,
                width: size[0],
                layer: null,
            };
            this.#capture = capture;
        }
        // The capture covers the whole scene, drawn back as one quad.
        if (capture.layer?.size[0] === projection[0] && capture.layer.size[1] === projection[1]) {
            return capture;
        }
        capture.layer = {
            additive: false,
            animation: EffectCompiler.compile([]),
            frames: null,
            glTexture: capture.texture,
            opacity: 1,
            origin: [projection[0] / 2, projection[1] / 2],
            rotation: 0,
            scale: [1, 1],
            size: [projection[0], projection[1]],
            tint: [1, 1, 1],
            u: 1,
            v: 1,
        };
        return capture;
    }
    #samplePointer(timestamp) {
        const tracker = MousePosTracker;
        const { height, left, top, width } = this.#canvasViewport.bounds;
        const x = Number(tracker?._x);
        const y = Number(tracker?._y);
        const targetX = Number.isFinite(x)
            ? Math.min(1, Math.max(0, (x - left) / width))
            : this.#pointer[0];
        const targetY = Number.isFinite(y)
            ? Math.min(1, Math.max(0, (y - top) / height))
            : this.#pointer[1];
        const elapsed = Math.min(0.1, Math.max(0, (timestamp - this.#pointerTimestamp) / 1000));
        const blend = this.#pointerTimestamp ? 1 - Math.exp(-elapsed * 12) : 1;
        this.#pointer[0] += (targetX - this.#pointer[0]) * blend;
        this.#pointer[1] += (targetY - this.#pointer[1]) * blend;
        this.#pointerTimestamp = timestamp;
        return this.#pointer;
    }
}
