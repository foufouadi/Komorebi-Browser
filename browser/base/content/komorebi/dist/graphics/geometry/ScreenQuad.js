/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { FULLSCREEN_VERTICES, FULLSCREEN_UVS } from "./Geometry.js";
import { createStaticBuffer } from "../BufferUtils.js";
export class ScreenQuad {
    positionBuffer;
    texCoordBuffer;
    constructor(gl) {
        this.positionBuffer = createStaticBuffer(gl, FULLSCREEN_VERTICES);
        this.texCoordBuffer = createStaticBuffer(gl, FULLSCREEN_UVS);
    }
}
