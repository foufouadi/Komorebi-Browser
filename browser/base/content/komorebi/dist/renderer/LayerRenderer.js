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
    #graphics;
    #program;
    #textureBuffer;
    constructor(graphics, program) {
        this.#graphics = graphics;
        this.#program = program;
        this.#textureBuffer = this.#createBuffer();
    }
    updateVideoTexture(layer) {
        if (!layer.video || layer.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
        }
        const gl = this.#graphics.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, layer.glTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.video);
    }
    draw(layer, sourceTexture, timing) {
        const gl = this.#graphics.gl;
        const { elapsed, timestamp, animationStart } = timing;
        const transform = layer.animation.transform;
        const transformAngle = sampleProperty(transform.angle, elapsed, 0)[0];
        const transformOffset = sampleProperty(transform.offset, elapsed, [0, 0]);
        const transformScale = sampleProperty(transform.scale, elapsed, [1, 1]);
        const vertexTransform = Boolean(transform.enabled) && transform.mode === 1;
        const frame = currentFrame(layer.frames, timestamp, animationStart);
        const left = frame?.left ?? 0;
        const right = frame?.right ?? layer.u;
        const top = frame?.top ?? 0;
        const bottom = frame?.bottom ?? layer.v;
        gl.uniform2f(gl.getUniformLocation(this.#program, "uOrigin"), layer.origin[0] + (vertexTransform ? transformOffset[0] * layer.size[0] : 0), layer.origin[1] + (vertexTransform ? transformOffset[1] * layer.size[1] : 0));
        gl.uniform2f(gl.getUniformLocation(this.#program, "uSize"), layer.size[0] * layer.scale[0] * (vertexTransform ? transformScale[0] : 1), layer.size[1] * layer.scale[1] * (vertexTransform ? transformScale[1] : 1));
        // uOrigin/worldPosition live in raw top-left screen space (see
        // SceneVertexShader's "1.0 - y/uProjection.y" flip), which is the
        // Y-mirror of Linux's centered Y-up scene space. Rotating a
        // Y-mirrored offset by the same angle as CImage::updateScreenSpacePosition's
        // rotate(-angle, Z) needs the sign flipped back, i.e. +layer.rotation here.
        gl.uniform1f(gl.getUniformLocation(this.#program, "uRotation"), layer.rotation + (vertexTransform ? transformAngle : 0));
        gl.uniform1f(gl.getUniformLocation(this.#program, "uOpacity"), layer.opacity);
        gl.uniform3f(gl.getUniformLocation(this.#program, "uTint"), layer.tint[0], layer.tint[1], layer.tint[2]);
        this.#setScrollTransformUniforms(layer.animation, elapsed, transformAngle, transformOffset, transformScale);
        gl.uniform2f(gl.getUniformLocation(this.#program, "uTextureOrigin"), left, top);
        gl.uniform2f(gl.getUniformLocation(this.#program, "uTextureSize"), right - left, bottom - top);
        if (layer.puppetIndexBuffer) {
            this.#bindAttribute("aPosition", layer.puppetPositionBuffer);
            this.#bindAttribute("aTexCoord", layer.puppetTexCoordBuffer);
        }
        else {
            this.#bindAttribute("aPosition", this.#graphics.layerQuad.positionBuffer);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.#textureBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([left, top, right, top, left, bottom, left, bottom, right, top, right, bottom]), gl.STREAM_DRAW);
            this.#bindAttribute("aTexCoord", this.#textureBuffer);
        }
        gl.blendFunc(gl.SRC_ALPHA, layer.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(gl.getUniformLocation(this.#program, "uTexture"), 0);
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
        const location = gl.getAttribLocation(this.#program, name);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    }
    #setScrollTransformUniforms(animation, elapsed, transformAngle, transformOffset, transformScale) {
        const gl = this.#graphics.gl;
        const scrollSpeed = sampleProperty(animation.scroll.speed, elapsed, [0, 0]);
        const scrollRepeat = sampleProperty(animation.scroll.repeat, elapsed, [1, 1]);
        gl.uniform3f(gl.getUniformLocation(this.#program, "uScroll"), animation.scroll.enabled, scrollSpeed[0], scrollSpeed[1]);
        gl.uniform2f(gl.getUniformLocation(this.#program, "uScrollRepeat"), scrollRepeat[0], scrollRepeat[1]);
        gl.uniform4f(gl.getUniformLocation(this.#program, "uTransform"), animation.transform.enabled && animation.transform.mode === 0 ? 1 : 0, transformAngle, transformScale[0], transformScale[1]);
        gl.uniform2f(gl.getUniformLocation(this.#program, "uTransformOffset"), transformOffset[0], transformOffset[1]);
    }
}
