/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const IDENTITY_QUAT = new Float64Array([0, 0, 0, 1]);
// out = a * b for column-major 4x4 matrices stored at the given offsets; out must not overlap a or b.
function multiply(out, outOffset, a, aOffset, b, bOffset) {
    for (let column = 0; column < 4; column++) {
        const b0 = b[bOffset + column * 4];
        const b1 = b[bOffset + column * 4 + 1];
        const b2 = b[bOffset + column * 4 + 2];
        const b3 = b[bOffset + column * 4 + 3];
        for (let row = 0; row < 4; row++) {
            out[outOffset + column * 4 + row] =
                a[aOffset + row] * b0 +
                    a[aOffset + 4 + row] * b1 +
                    a[aOffset + 8 + row] * b2 +
                    a[aOffset + 12 + row] * b3;
        }
    }
}
// Inverse of a general 4x4 column-major matrix; returns identity when singular.
function invert(m) {
    const inv = new Float64Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
    const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (!det) {
        return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
    for (let index = 0; index < 16; index++) {
        inv[index] /= det;
    }
    return inv;
}
// Quaternion (x, y, z, w) from XYZ euler angles as Rz * Ry * Rx.
function eulerToQuat(out, source, offset) {
    const hx = source[offset] / 2;
    const hy = source[offset + 1] / 2;
    const hz = source[offset + 2] / 2;
    const sx = Math.sin(hx);
    const cx = Math.cos(hx);
    const sy = Math.sin(hy);
    const cy = Math.cos(hy);
    const sz = Math.sin(hz);
    const cz = Math.cos(hz);
    out[0] = cz * cy * sx - sz * sy * cx;
    out[1] = cz * sy * cx + sz * cy * sx;
    out[2] = sz * cy * cx - cz * sy * sx;
    out[3] = cz * cy * cx + sz * sy * sx;
}
// out = a * b; out may alias a or b.
function quatMultiply(out, a, b) {
    const x = a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1];
    const y = a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0];
    const z = a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3];
    const w = a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2];
    out[0] = x;
    out[1] = y;
    out[2] = z;
    out[3] = w;
}
function quatConjugate(out, a) {
    out[0] = -a[0];
    out[1] = -a[1];
    out[2] = -a[2];
    out[3] = a[3];
}
// Shortest-path spherical interpolation; out may alias a.
function quatSlerp(out, a, b, t) {
    let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const sign = dot < 0 ? -1 : 1;
    dot *= sign;
    let scaleA = 1 - t;
    let scaleB = t * sign;
    if (dot < 0.9995) {
        const theta = Math.acos(dot);
        const sine = Math.sin(theta);
        scaleA = Math.sin((1 - t) * theta) / sine;
        scaleB = (Math.sin(t * theta) / sine) * sign;
    }
    const x = a[0] * scaleA + b[0] * scaleB;
    const y = a[1] * scaleA + b[1] * scaleB;
    const z = a[2] * scaleA + b[2] * scaleB;
    const w = a[3] * scaleA + b[3] * scaleB;
    const length = Math.hypot(x, y, z, w) || 1;
    out[0] = x / length;
    out[1] = y / length;
    out[2] = z / length;
    out[3] = w / length;
}
/**
 * Converts skinned (or rest) 2D puppet positions into the layer's three
 * position-dependent vertex arrays.
 */
export function fillPuppetArrays(layer, source, positions, effectPositions, outputTexCoords) {
    const width = layer.size[0] || 1;
    const height = layer.size[1] || 1;
    for (let index = 0; index < positions.length; index += 2) {
        positions[index] = source[index] / width;
        positions[index + 1] = source[index + 1] / height;
        const effectIndex = (index / 2) * 3;
        effectPositions[effectIndex] = width / 2 + source[index];
        effectPositions[effectIndex + 1] = height / 2 + source[index + 1];
        effectPositions[effectIndex + 2] = 0;
        outputTexCoords[index] = effectPositions[effectIndex] / layer.width;
        outputTexCoords[index + 1] = effectPositions[effectIndex + 1] / layer.height;
    }
}
/**
 * Plays the animation layers of a scene object on a puppet skeleton and
 * skins its vertices. All working memory is allocated up front.
 */
export class PuppetAnimator {
    #skeleton;
    #boneCount;
    #layers = [];
    #rest = 1;
    #offsets;
    #bindTranslations;
    #world;
    #final;
    #local = new Float64Array(16);
    #translation = new Float64Array(3);
    #scale = new Float64Array(3);
    #quat = new Float64Array(4);
    #quatBase = new Float64Array(4);
    #quatA = new Float64Array(4);
    #quatB = new Float64Array(4);
    #quatTemp = new Float64Array(4);
    #quatConj = new Float64Array(4);

    /**
     * @param {object} skeleton The skeleton read by MdlParser.
     * @param {object[]|undefined} animationLayers The scene object's `animationlayers`.
     */
    constructor(skeleton, animationLayers) {
        this.#skeleton = skeleton;
        const bones = skeleton.bones;
        const count = (this.#boneCount = bones.length);
        this.#world = new Float32Array(count * 16);
        this.#final = new Float32Array(count * 16);
        this.#offsets = new Float32Array(count * 16);
        this.#bindTranslations = new Float32Array(count * 3);
        const bindWorld = new Float32Array(count * 16);
        for (let index = 0; index < count; index++) {
            const { parent, local } = bones[index];
            if (parent < 0) {
                bindWorld.set(local, index * 16);
            }
            else {
                multiply(bindWorld, index * 16, bindWorld, parent * 16, local, 0);
            }
            this.#offsets.set(invert(bindWorld.subarray(index * 16, index * 16 + 16)), index * 16);
            this.#bindTranslations.set([local[12], local[13], local[14]], index * 3);
        }
        const animations = new Map(skeleton.animations.map(animation => [animation.id, animation]));
        for (const entry of Array.isArray(animationLayers) ? animationLayers : []) {
            const animation = animations.get(Number(entry?.animation));
            if (!animation ||
                entry.visible === false ||
                !(animation.fps > 0) ||
                !(animation.length > 0)) {
                continue;
            }
            const blend = Number.isFinite(Number(entry.blend)) ? Number(entry.blend) : 1;
            const rate = Number.isFinite(Number(entry.rate)) ? Number(entry.rate) : 1;
            const baseQuats = new Float64Array(count * 4);
            const scratch = new Float64Array(4);
            for (let index = 0; index < count; index++) {
                const track = animation.tracks[index];
                if (track?.length >= 9) {
                    eulerToQuat(scratch, track, 3);
                    baseQuats.set(scratch, index * 4);
                }
            }
            this.#layers.push({
                animation,
                baseQuats,
                blend,
                rate,
                time: 0,
                weight: 0,
                frameA: 0,
                frameB: 0,
                fraction: 0,
            });
        }
        this.#computeWeights();
        this.advance(0);
    }

    get active() {
        return this.#layers.length > 0;
    }

    #computeWeights() {
        const layers = this.#layers;
        let total = 0;
        for (const layer of layers) {
            total += layer.blend;
        }
        let rest = 1;
        if (total > 1) {
            for (const layer of layers) {
                layer.weight = layer.blend / total;
            }
            rest = 0;
        }
        else {
            for (let index = layers.length - 1; index >= 0; index--) {
                const layer = layers[index];
                layer.weight = rest * layer.blend;
                rest = Math.max(0, rest * (1 - layer.blend));
            }
        }
        this.#rest = rest;
    }

    advance(dtSeconds) {
        for (const layer of this.#layers) {
            const { fps, length, mode } = layer.animation;
            const mirror = mode === "mirror";
            const frames = mirror ? length * 2 : length;
            const duration = frames / fps;
            layer.time += dtSeconds * layer.rate;
            const current = ((layer.time % duration) + duration) % duration;
            const position = current * fps;
            const floor = Math.floor(position);
            let a = floor % frames;
            let b = (a + 1) % frames;
            if (mirror) {
                if (a >= length) {
                    a = length - 1 - (a - length);
                }
                if (b >= length) {
                    b = length - 1 - (b - length);
                }
            }
            layer.frameA = a;
            layer.frameB = b;
            layer.fraction = position - floor;
        }
    }

    // Fills out with the skinned positions in the layout MdlParser produces (Y negated).
    skin(out) {
        this.#poseBones();
        const { boneIndices, boneWeights, rawPositions } = this.#skeleton;
        const final = this.#final;
        const boneCount = this.#boneCount;
        const vertexCount = rawPositions.length / 3;
        for (let vertex = 0; vertex < vertexCount; vertex++) {
            const x = rawPositions[vertex * 3];
            const y = rawPositions[vertex * 3 + 1];
            const z = rawPositions[vertex * 3 + 2];
            let sumX = 0;
            let sumY = 0;
            let total = 0;
            for (let k = 0; k < 4; k++) {
                const weight = boneWeights[vertex * 4 + k];
                const bone = boneIndices[vertex * 4 + k];
                if (!(weight > 0) || bone >= boneCount) {
                    continue;
                }
                const o = bone * 16;
                sumX += weight * (final[o] * x + final[o + 4] * y + final[o + 8] * z + final[o + 12]);
                sumY += weight * (final[o + 1] * x + final[o + 5] * y + final[o + 9] * z + final[o + 13]);
                total += weight;
            }
            if (total > 0) {
                out[vertex * 2] = sumX / total;
                out[vertex * 2 + 1] = -(sumY / total);
            }
            else {
                out[vertex * 2] = x;
                out[vertex * 2 + 1] = -y;
            }
        }
    }

    #poseBones() {
        const bones = this.#skeleton.bones;
        const layers = this.#layers;
        const rest = this.#rest;
        const local = this.#local;
        const translation = this.#translation;
        const scale = this.#scale;
        const quat = this.#quat;
        const quatBase = this.#quatBase;
        const quatA = this.#quatA;
        const quatB = this.#quatB;
        const temp = this.#quatTemp;
        const conjugate = this.#quatConj;
        for (let index = 0; index < this.#boneCount; index++) {
            translation[0] = this.#bindTranslations[index * 3] * rest;
            translation[1] = this.#bindTranslations[index * 3 + 1] * rest;
            translation[2] = this.#bindTranslations[index * 3 + 2] * rest;
            scale[0] = scale[1] = scale[2] = rest;
            quat.set(IDENTITY_QUAT);
            for (const layer of layers) {
                const track = layer.animation.tracks[index];
                const frames = track ? track.length / 9 : 0;
                if (!frames) {
                    continue;
                }
                const { blend, weight, fraction } = layer;
                const a = (layer.frameA % frames) * 9;
                const b = (layer.frameB % frames) * 9;
                for (let axis = 0; axis < 3; axis++) {
                    const basePos = track[axis];
                    translation[axis] +=
                        weight * basePos +
                            blend * ((track[a + axis] - basePos) * (1 - fraction) + (track[b + axis] - basePos) * fraction);
                    const baseScale = track[6 + axis];
                    scale[axis] +=
                        weight * baseScale +
                            blend * ((track[a + 6 + axis] - baseScale) * (1 - fraction) + (track[b + 6 + axis] - baseScale) * fraction);
                }
                for (let component = 0; component < 4; component++) {
                    quatBase[component] = layer.baseQuats[index * 4 + component];
                }
                quatConjugate(conjugate, quatBase);
                eulerToQuat(quatA, track, a + 3);
                quatMultiply(quatA, quatA, conjugate);
                eulerToQuat(quatB, track, b + 3);
                quatMultiply(quatB, quatB, conjugate);
                quatSlerp(quatA, quatA, quatB, fraction);
                quatSlerp(quatA, quatA, IDENTITY_QUAT, 1 - blend);
                quatSlerp(temp, quatBase, IDENTITY_QUAT, 1 - weight);
                quatMultiply(quatA, quatA, temp);
                quatMultiply(quat, quat, quatA);
            }
            quatSlerp(quat, quat, IDENTITY_QUAT, rest);
            const x = quat[0];
            const y = quat[1];
            const z = quat[2];
            const w = quat[3];
            local[0] = (1 - 2 * (y * y + z * z)) * scale[0];
            local[1] = 2 * (x * y + z * w) * scale[0];
            local[2] = 2 * (x * z - y * w) * scale[0];
            local[3] = 0;
            local[4] = 2 * (x * y - z * w) * scale[1];
            local[5] = (1 - 2 * (x * x + z * z)) * scale[1];
            local[6] = 2 * (y * z + x * w) * scale[1];
            local[7] = 0;
            local[8] = 2 * (x * z + y * w) * scale[2];
            local[9] = 2 * (y * z - x * w) * scale[2];
            local[10] = (1 - 2 * (x * x + y * y)) * scale[2];
            local[11] = 0;
            local[12] = translation[0];
            local[13] = translation[1];
            local[14] = translation[2];
            local[15] = 1;
            const parent = bones[index].parent;
            if (parent < 0) {
                this.#world.set(local, index * 16);
            }
            else {
                multiply(this.#world, index * 16, this.#world, parent * 16, local, 0);
            }
            multiply(this.#final, index * 16, this.#world, index * 16, this.#offsets, index * 16);
        }
    }
}
