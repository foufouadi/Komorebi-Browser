/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export const QUAD_VERTICES = new Float32Array([
    -0.5, -0.5,
    0.5, -0.5,
    -0.5, 0.5,
    -0.5, 0.5,
    0.5, -0.5,
    0.5, 0.5,
]);
export const FULLSCREEN_VERTICES = new Float32Array([
    -1.0, -1.0, 0.0,
    1.0, -1.0, 0.0,
    -1.0, 1.0, 0.0,
    -1.0, 1.0, 0.0,
    1.0, -1.0, 0.0,
    1.0, 1.0, 0.0,
]);
export const FULLSCREEN_UVS = new Float32Array([
    0.0, 1.0,
    1.0, 1.0,
    0.0, 0.0,
    0.0, 0.0,
    1.0, 1.0,
    1.0, 0.0,
]);
