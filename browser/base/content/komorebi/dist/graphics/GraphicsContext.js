/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { ProgramCache } from "./ProgramCache.js";
import { TextureUploader } from "./TextureUploader.js";
import { LayerQuad } from "./geometry/LayerQuad.js";
import { ScreenQuad } from "./geometry/ScreenQuad.js";
export class GraphicsContext {
    gl;
    programs;
    textures;
    whiteTexture;
    layerQuad;
    screenQuad;
    constructor(gl) {
        this.gl = gl;
        // WebGL1 needs this requested from JS too, not just declared in shader source, or fwidth/dFdx/dFdy report unsupported.
        gl.getExtension("OES_standard_derivatives");
        this.programs = new ProgramCache(gl);
        this.textures = new TextureUploader(gl);
        this.whiteTexture = this.#createWhiteTexture();
        this.layerQuad = new LayerQuad(gl);
        this.screenQuad = new ScreenQuad(gl);
    }
    dispose() {
        const gl = this.gl;
        this.programs.dispose();
        gl.deleteTexture(this.whiteTexture);
        gl.deleteBuffer(this.layerQuad.positionBuffer);
        gl.deleteBuffer(this.screenQuad.positionBuffer);
        gl.deleteBuffer(this.screenQuad.texCoordBuffer);
    }
    #createWhiteTexture() {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) {
            throw new Error("Failed to create WebGL texture");
        }
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        return texture;
    }
}
