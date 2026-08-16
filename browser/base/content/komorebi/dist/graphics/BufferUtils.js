/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export function createStaticBuffer(gl, data, target = gl.ARRAY_BUFFER) {
    const buffer = gl.createBuffer();
    if (!buffer) {
        throw new Error("Failed to create WebGL buffer");
    }
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
}
