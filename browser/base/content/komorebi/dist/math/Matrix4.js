/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/** Column-major 4x4 matrix, matching the layout WebGL's uniformMatrix4fv expects. */
export class Matrix4 {
    values;
    constructor(values) {
        this.values = values;
    }
    static identity() {
        // prettier-ignore
        return new Matrix4(new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1,
        ]));
    }
    static translation(x, y, z = 0) {
        const matrix = Matrix4.identity();
        matrix.values[12] = x;
        matrix.values[13] = y;
        matrix.values[14] = z;
        return matrix;
    }
    static scaling(x, y, z = 1) {
        const matrix = Matrix4.identity();
        matrix.values[0] = x;
        matrix.values[5] = y;
        matrix.values[10] = z;
        return matrix;
    }
    static rotationZ(radians) {
        const matrix = Matrix4.identity();
        const sine = Math.sin(radians);
        const cosine = Math.cos(radians);
        matrix.values[0] = cosine;
        matrix.values[1] = sine;
        matrix.values[4] = -sine;
        matrix.values[5] = cosine;
        return matrix;
    }
    // Y row negated to match this engine's Y-down pixel space (y=0 at top), like SceneVertexShader's own flip.
    static orthographic(width, height) {
        return new Matrix4(new Float32Array([
            2 / width,
            0,
            0,
            0,
            0,
            -2 / height,
            0,
            0,
            0,
            0,
            -1,
            0,
            -1,
            1,
            0,
            1,
        ]));
    }
    static inverseOrthographic(width, height) {
        return new Matrix4(new Float32Array([
            width / 2,
            0,
            0,
            0,
            0,
            -height / 2,
            0,
            0,
            0,
            0,
            -1,
            0,
            width / 2,
            height / 2,
            0,
            1,
        ]));
    }
    multiply(other) {
        const a = this.values;
        const b = other.values;
        const result = new Float32Array(16);
        for (let column = 0; column < 4; column++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let index = 0; index < 4; index++) {
                    sum += a[index * 4 + row] * b[column * 4 + index];
                }
                result[column * 4 + row] = sum;
            }
        }
        return new Matrix4(result);
    }
    clone() {
        return new Matrix4(new Float32Array(this.values));
    }
}
