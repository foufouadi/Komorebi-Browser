/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/** TEXI0001 flag bits (WallpaperEngine/Data/Assets/Texture.h). */
const TEX_FLAG_NO_INTERPOLATION = 1;
const TEX_FLAG_CLAMP_UVS = 2;
export class TextureUploader {
    #gl;
    constructor(gl) {
        this.#gl = gl;
    }
    /** Overwrites the texels of an uploaded texture; `resize` reallocates it for a new size. */
    update(glTexture, pixels, width, height, resize = false) {
        const gl = this.#gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (resize) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        }
        else {
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        }
    }
    upload(texture) {
        const gl = this.#gl;
        const glTexture = gl.createTexture();
        if (!glTexture) {
            throw new Error("Failed to create WebGL texture");
        }
        gl.bindTexture(gl.TEXTURE_2D, glTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        const flags = texture.flags ?? TEX_FLAG_CLAMP_UVS;
        const nearest = Boolean(flags & TEX_FLAG_NO_INTERPOLATION);
        const wrap = flags & TEX_FLAG_CLAMP_UVS ? gl.CLAMP_TO_EDGE : gl.REPEAT;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        if (texture.bitmap || texture.video) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture.bitmap ?? texture.video);
        }
        else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.textureWidth, texture.textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, texture.pixels);
        }
        return {
            glTexture,
            width: texture.width,
            height: texture.height,
            textureWidth: texture.textureWidth,
            textureHeight: texture.textureHeight,
            u: texture.width / texture.textureWidth,
            v: texture.height / texture.textureHeight,
            frames: texture.spriteSheet?.frames ?? null,
            video: texture.video,
            objectURL: texture.objectURL,
        };
    }
}
