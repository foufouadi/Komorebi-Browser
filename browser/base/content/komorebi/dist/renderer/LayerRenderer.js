/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { sampleProperty } from "../effects/AnimatedProperty.js";
import { currentFrame } from "../graphics/SpriteFrame.js";
export class LayerRenderer {
    #current;
    #graphics;
    #program;
    #textureBuffer;
    #videoTimes = new WeakMap();
    constructor(graphics, program) {
        this.#graphics = graphics;
        this.#program = program;
        this.#textureBuffer = this.#createBuffer();
    }
    updateVideoTexture(layer) {
        if (!layer.video || layer.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
        }
        const currentTime = layer.video.currentTime;
        if (this.#videoTimes.get(layer.video) === currentTime) {
            return;
        }
        this.#videoTimes.set(layer.video, currentTime);
        const gl = this.#graphics.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, layer.glTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.video);
    }
    // `program` replaces the stock layer program (blend modes); it must take the same uniforms and attributes.
    draw(layer, sourceTexture, timing, program = this.#program) {
        const gl = this.#graphics.gl;
        const { elapsed, timestamp, animationStart } = timing;
        this.#current = program;
        const transform = layer.animation.transform;
        const transformAngle = sampleProperty(transform.angle, elapsed, 0)[0];
        const transformOffset = sampleProperty(transform.offset, elapsed, [0, 0]);
        const transformScale = sampleProperty(transform.scale, elapsed, [1, 1]);
        const vertexTransform = Boolean(transform.enabled) && transform.mode === 1;
        // A script can pin a sprite sheet to one frame.
        const frame = layer.frameOverride >= 0 && layer.frames?.length
            ? layer.frames[layer.frameOverride % layer.frames.length]
            : currentFrame(layer.frames, timestamp, animationStart);
        const left = frame?.left ?? 0;
        const right = frame?.right ?? layer.u;
        const top = frame?.top ?? 0;
        const bottom = frame?.bottom ?? layer.v;
        // Camera parallax: layers nearer the viewer (larger depth) slide further.
        const depth = layer.parallaxDepth;
        const parallaxX = depth ? timing.cameraX * depth[0] : 0;
        const parallaxY = depth ? timing.cameraY * depth[1] : 0;
        gl.uniform2f(this.#graphics.uniform(this.#current, "uOrigin"), layer.origin[0] + parallaxX + (vertexTransform ? transformOffset[0] * layer.size[0] : 0), layer.origin[1] + parallaxY + (vertexTransform ? transformOffset[1] * layer.size[1] : 0));
        gl.uniform2f(this.#graphics.uniform(this.#current, "uSize"), layer.size[0] * layer.scale[0] * (vertexTransform ? transformScale[0] : 1), layer.size[1] * layer.scale[1] * (vertexTransform ? transformScale[1] : 1));
        // uOrigin/worldPosition live in raw top-left screen space (see
        // SceneVertexShader's "1.0 - y/uProjection.y" flip), which is the
        // Y-mirror of Linux's centered Y-up scene space. Rotating a
        // Y-mirrored offset by the same angle as CImage::updateScreenSpacePosition's
        // rotate(-angle, Z) needs the sign flipped back, i.e. +layer.rotation here.
        gl.uniform1f(this.#graphics.uniform(this.#current, "uRotation"), layer.rotation + (vertexTransform ? transformAngle : 0));
        gl.uniform1f(this.#graphics.uniform(this.#current, "uOpacity"), layer.opacityAnimation
            ? sampleProperty(layer.opacityAnimation, elapsed, 1)[0]
            : layer.opacity);
        gl.uniform3f(this.#graphics.uniform(this.#current, "uTint"), layer.tint[0], layer.tint[1], layer.tint[2]);
        this.#setScrollTransformUniforms(layer.animation, elapsed, transformAngle, transformOffset, transformScale);
        gl.uniform2f(this.#graphics.uniform(this.#current, "uTextureOrigin"), left, top);
        gl.uniform2f(this.#graphics.uniform(this.#current, "uTextureSize"), right - left, bottom - top);
        if (layer.puppetIndexBuffer) {
            this.#bindAttribute("aPosition", layer.puppetPositionBuffer);
            this.#bindAttribute("aTexCoord", sourceTexture === layer.glTexture
                ? layer.puppetTexCoordBuffer
                : layer.puppetOutputTexCoordBuffer);
        }
        else {
            this.#bindAttribute("aPosition", this.#graphics.layerQuad.positionBuffer);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.#textureBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, top, right, top, left, bottom, left, bottom, right, top, right, bottom]), gl.STREAM_DRAW);
            this.#bindAttribute("aTexCoord", this.#textureBuffer);
        }
        gl.blendFunc(gl.SRC_ALPHA, layer.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture === layer.glTexture && frame?.imageIndex
            ? (layer.imageTextures?.[frame.imageIndex] ?? sourceTexture)
            : sourceTexture);
        gl.uniform1i(this.#graphics.uniform(this.#current, "uTexture"), 0);
        if (layer.puppetIndexBuffer) {
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, layer.puppetIndexBuffer);
            gl.drawElements(gl.TRIANGLES, layer.puppetIndexCount ?? 0, gl.UNSIGNED_SHORT, 0);
        }
        else {
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
    }
    #createBuffer() {
        const buffer = this.#graphics.gl.createBuffer();
        if (!buffer) {
            throw new Error("Failed to create WebGL buffer");
        }
        return buffer;
    }
    #bindAttribute(name, buffer) {
        const gl = this.#graphics.gl;
        const location = this.#graphics.attrib(this.#current, name);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }
    #setScrollTransformUniforms(animation, elapsed, transformAngle, transformOffset, transformScale) {
        const gl = this.#graphics.gl;
        const scrollSpeed = sampleProperty(animation.scroll.speed, elapsed, [0, 0]);
        const scrollRepeat = sampleProperty(animation.scroll.repeat, elapsed, [1, 1]);
        gl.uniform3f(this.#graphics.uniform(this.#current, "uScroll"), animation.scroll.enabled, scrollSpeed[0], scrollSpeed[1]);
        gl.uniform2f(this.#graphics.uniform(this.#current, "uScrollRepeat"), scrollRepeat[0], scrollRepeat[1]);
        gl.uniform4f(this.#graphics.uniform(this.#current, "uTransform"), animation.transform.enabled && animation.transform.mode === 0 ? 1 : 0, transformAngle, transformScale[0], transformScale[1]);
        gl.uniform2f(this.#graphics.uniform(this.#current, "uTransformOffset"), transformOffset[0], transformOffset[1]);
    }
}
