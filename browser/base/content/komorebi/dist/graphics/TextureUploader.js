/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { decodeDXT, dxtByteLength } from "../parser/DxtDecoder.js";
/** TEXI0001 flag bits (WallpaperEngine/Data/Assets/Texture.h). */
const TEX_FLAG_NO_INTERPOLATION = 1;
const TEX_FLAG_CLAMP_UVS = 2;
export class TextureUploader {
    #gl;
    #s3tc;
    constructor(gl) {
        this.#gl = gl;
        this.#s3tc = gl.getExtension("WEBGL_compressed_texture_s3tc");
    }
    /** Uploads the DXT levels as they are; returns false (texture state untouched in effect) when the caller must decode instead. */
    #uploadCompressed(compressed, nearest) {
        const gl = this.#gl;
        const s3tc = this.#s3tc;
        if (!s3tc || !compressed?.levels?.length) {
            return false;
        }
        const internalFormat = {
            4: s3tc.COMPRESSED_RGBA_S3TC_DXT5_EXT,
            6: s3tc.COMPRESSED_RGBA_S3TC_DXT3_EXT,
            7: s3tc.COMPRESSED_RGBA_S3TC_DXT1_EXT,
        }[compressed.format];
        if (!internalFormat) {
            return false;
        }
        // Keep only the leading levels whose size matches; a mip chain with a bad level would be incomplete.
        // Each level must also halve the previous one, or the texture is incomplete and samples black without any GL error.
        let count = 0;
        const [base] = compressed.levels;
        for (const level of compressed.levels) {
            if (level.data.length !== dxtByteLength(compressed.format, level.width, level.height) ||
                level.width !== Math.max(1, base.width >> count) ||
                level.height !== Math.max(1, base.height >> count)) {
                break;
            }
            count++;
        }
        if (!count) {
            return false;
        }
        while (gl.getError() !== gl.NO_ERROR) {
            // Drop errors left by earlier calls so they are not blamed on this upload.
        }
        for (let index = 0; index < count; index++) {
            const level = compressed.levels[index];
            gl.compressedTexImage2D(gl.TEXTURE_2D, index, internalFormat, level.width, level.height, 0, level.data);
        }
        if (gl.getError() !== gl.NO_ERROR) {
            return false;
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, count - 1);
        if (count > 1) {
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST_MIPMAP_NEAREST : gl.LINEAR_MIPMAP_LINEAR);
        }
        return true;
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
        else if (!texture.compressed || !this.#uploadCompressed(texture.compressed, nearest)) {
            let pixels = texture.pixels;
            if (!pixels && texture.compressed) {
                const level = texture.compressed.levels[0];
                pixels = decodeDXT(texture.compressed.format, level.width, level.height, level.data);
            }
            // A failed compressed upload may have left levels behind; a single-level RGBA texture must not see them.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, texture.textureWidth, texture.textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
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
