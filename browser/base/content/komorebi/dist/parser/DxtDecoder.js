/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const DXT5 = 4;
const DXT3 = 6;
const DXT1 = 7;
/** Byte size of one level of a DXT texture, or 0 for a non-DXT format. */
export function dxtByteLength(format, width, height) {
    if (format !== DXT1 && format !== DXT3 && format !== DXT5) {
        return 0;
    }
    return Math.ceil(width / 4) * Math.ceil(height / 4) * (format === DXT1 ? 8 : 16);
}
/** Decodes one DXT level to RGBA8888. */
export function decodeDXT(format, width, height, data) {
    const pixels = new Uint8ClampedArray(width * height * 4);
    const blockSize = format === DXT1 ? 8 : 16;
    const expectedLength = dxtByteLength(format, width, height);
    if (data.length !== expectedLength) {
        throw new Error(`Invalid DXT texture size: ${data.length}/${expectedLength}`);
    }
    let offset = 0;
    for (let blockY = 0; blockY < Math.ceil(height / 4); blockY++) {
        for (let blockX = 0; blockX < Math.ceil(width / 4); blockX++) {
            const alpha = decodeAlpha(format, data, offset);
            const colorOffset = offset + (format === DXT1 ? 0 : 8);
            decodeColorBlock(data, colorOffset, pixels, width, height, blockX, blockY, alpha, format === DXT1);
            offset += blockSize;
        }
    }
    return pixels;
}
function decodeAlpha(format, data, offset) {
    if (format === DXT1) {
        return null;
    }
    const values = new Uint8Array(16);
    if (format === DXT3) {
        for (let index = 0; index < 16; index++) {
            const nibble = (data[offset + Math.floor(index / 2)] >> ((index % 2) * 4)) & 15;
            values[index] = nibble * 17;
        }
        return values;
    }
    const palette = new Uint8Array(8);
    palette[0] = data[offset];
    palette[1] = data[offset + 1];
    if (palette[0] > palette[1]) {
        for (let index = 1; index <= 6; index++) {
            palette[index + 1] = Math.round(((7 - index) * palette[0] + index * palette[1]) / 7);
        }
    }
    else {
        for (let index = 1; index <= 4; index++) {
            palette[index + 1] = Math.round(((5 - index) * palette[0] + index * palette[1]) / 5);
        }
        palette[6] = 0;
        palette[7] = 255;
    }
    let bits = 0n;
    for (let index = 0; index < 6; index++) {
        bits |= BigInt(data[offset + 2 + index]) << BigInt(index * 8);
    }
    for (let index = 0; index < 16; index++) {
        values[index] = palette[Number((bits >> BigInt(index * 3)) & 7n)];
    }
    return values;
}
function decodeColorBlock(data, offset, pixels, width, height, blockX, blockY, alpha, allowTransparency) {
    const color0 = data[offset] | (data[offset + 1] << 8);
    const color1 = data[offset + 2] | (data[offset + 3] << 8);
    const colors = [decode565(color0), decode565(color1)];
    if (color0 > color1 || !allowTransparency) {
        colors.push(mix(colors[0], colors[1], 2, 1, 3));
        colors.push(mix(colors[0], colors[1], 1, 2, 3));
    }
    else {
        colors.push(mix(colors[0], colors[1], 1, 1, 2));
        colors.push([0, 0, 0, 0]);
    }
    const indices = data[offset + 4] |
        (data[offset + 5] << 8) |
        (data[offset + 6] << 16) |
        (data[offset + 7] << 24);
    for (let index = 0; index < 16; index++) {
        const x = blockX * 4 + (index % 4);
        const y = blockY * 4 + Math.floor(index / 4);
        if (x >= width || y >= height) {
            continue;
        }
        const color = colors[(indices >>> (index * 2)) & 3];
        const destination = (y * width + x) * 4;
        pixels[destination] = color[0];
        pixels[destination + 1] = color[1];
        pixels[destination + 2] = color[2];
        pixels[destination + 3] = alpha ? alpha[index] : color[3];
    }
}
function decode565(value) {
    return [
        Math.round(((value >> 11) & 31) * (255 / 31)),
        Math.round(((value >> 5) & 63) * (255 / 63)),
        Math.round((value & 31) * (255 / 31)),
        255,
    ];
}
function mix(first, second, firstWeight, secondWeight, divisor) {
    return [
        Math.round((first[0] * firstWeight + second[0] * secondWeight) / divisor),
        Math.round((first[1] * firstWeight + second[1] * secondWeight) / divisor),
        Math.round((first[2] * firstWeight + second[2] * secondWeight) / divisor),
        255,
    ];
}
