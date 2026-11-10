/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const SUPPORTED_VERSIONS = new Set([
    "MDLV0013",
    "MDLV0016",
    "MDLV0017",
    "MDLV0019",
    "MDLV0021",
    "MDLV0023",
]);
const NO_PARENT = 0xffffffff;
const ALT_VERTEX_TAG = 0x0180000f;
const WIDE_VERTEX_TAG = 0x01800009;
class Reader {
    constructor(bytes) {
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.offset = 0;
    }
    get done() {
        return this.offset >= this.bytes.length;
    }
    u8() {
        return this.view.getUint8(this.offset++);
    }
    u16() {
        const value = this.view.getUint16(this.offset, true);
        this.offset += 2;
        return value;
    }
    u32() {
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }
    i32() {
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }
    f32() {
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }
    skip(count) {
        if (count < 0 || this.offset + count > this.bytes.length) {
            throw new RangeError("MDL skip out of range");
        }
        this.offset += count;
    }
    string() {
        const end = this.bytes.indexOf(0, this.offset);
        if (end < 0) {
            throw new RangeError("Unterminated MDL string");
        }
        const value = new TextDecoder().decode(this.bytes.subarray(this.offset, end));
        this.offset = end + 1;
        return value;
    }
    floats(count) {
        const values = new Float32Array(count);
        for (let index = 0; index < count; index++) {
            values[index] = this.f32();
        }
        return values;
    }
}
function versionNumber(tag) {
    return Number.parseInt(tag.slice(4), 10);
}
// Returns null when the file is not a complete structured model, so the caller can use the heuristic scan.
function parseStructured(bytes, version) {
    const reader = new Reader(bytes);
    reader.string();
    if (reader.i32() === 9) {
        return null;
    }
    reader.i32();
    reader.i32();
    reader.string();
    reader.i32();
    let current = reader.u32();
    const alt = current === 0;
    if (alt) {
        while (current !== ALT_VERTEX_TAG) {
            current = reader.u32();
        }
        current = reader.u32();
    }
    else if (current === WIDE_VERTEX_TAG) {
        current = reader.u32();
    }
    const stride = alt ? 80 : 52;
    if (!current || current % stride) {
        return null;
    }
    const vertexCount = current / stride;
    const positions = new Float32Array(vertexCount * 2);
    const rawPositions = new Float32Array(vertexCount * 3);
    const texCoords = new Float32Array(vertexCount * 2);
    const boneIndices = new Uint32Array(vertexCount * 4);
    const boneWeights = new Float32Array(vertexCount * 4);
    for (let index = 0; index < vertexCount; index++) {
        const x = reader.f32();
        const y = reader.f32();
        const z = reader.f32();
        rawPositions[index * 3] = x;
        rawPositions[index * 3 + 1] = y;
        rawPositions[index * 3 + 2] = z;
        positions[index * 2] = x;
        positions[index * 2 + 1] = -y;
        if (alt) {
            reader.skip(28);
        }
        for (let k = 0; k < 4; k++) {
            boneIndices[index * 4 + k] = reader.u32();
        }
        for (let k = 0; k < 4; k++) {
            boneWeights[index * 4 + k] = reader.f32();
        }
        texCoords[index * 2] = reader.f32();
        texCoords[index * 2 + 1] = reader.f32();
    }
    const indexBytes = reader.u32();
    if (!indexBytes || indexBytes % 6) {
        return null;
    }
    const indices = new Uint16Array(indexBytes / 2);
    for (let index = 0; index < indices.length; index++) {
        const value = reader.u16();
        if (value >= vertexCount) {
            return null;
        }
        indices[index] = value;
    }
    const mesh = { indices, positions, texCoords, version, skeleton: null };
    const marker = MdlParser.findMarker(bytes, "MDLS", reader.offset);
    if (marker >= bytes.length) {
        return mesh;
    }
    try {
        const skeleton = readSkeleton(reader, marker, alt, boneIndices, boneWeights, rawPositions);
        if (skeleton) {
            mesh.skeleton = skeleton;
        }
    }
    catch {
        mesh.skeleton = null;
    }
    return mesh;
}
function readSkeleton(reader, marker, alt, boneIndices, boneWeights, rawPositions) {
    reader.offset = marker;
    const skeletonVersion = versionNumber(reader.string());
    reader.u32();
    const boneCount = reader.u16();
    reader.u16();
    const bones = [];
    for (let index = 0; index < boneCount; index++) {
        reader.string();
        reader.i32();
        const parent = reader.u32();
        const size = reader.u32();
        if (size < 64 || (parent !== NO_PARENT && parent >= index)) {
            return null;
        }
        const local = reader.floats(16);
        reader.skip(size - 64);
        reader.string();
        bones.push({ parent: parent === NO_PARENT ? -1 : parent, local });
    }
    if (!bones.length) {
        return null;
    }
    const skeleton = {
        bones,
        animations: [],
        boneIndices,
        boneWeights,
        rawPositions,
    };
    try {
        if (skeletonVersion > 1) {
            reader.u16();
            if (reader.u8()) {
                reader.skip(boneCount * 64);
            }
            reader.skip(reader.u32() * 12);
            reader.u32();
            if (reader.u8()) {
                reader.skip(boneCount * 76);
            }
            if (reader.u8()) {
                reader.skip(boneCount * 4);
            }
        }
        skeleton.animations = readAnimations(reader, alt);
    }
    catch {
        skeleton.animations = [];
    }
    return skeleton;
}
function readAnimations(reader, alt) {
    let animationVersion = 0;
    while (!reader.done) {
        const tag = reader.string();
        if (tag.length !== 8) {
            continue;
        }
        if (tag.startsWith("MDAT")) {
            reader.u32();
            const count = reader.u16();
            for (let index = 0; index < count; index++) {
                reader.u16();
                reader.string();
                reader.skip(64);
            }
        }
        else if (tag.startsWith("MDLA")) {
            animationVersion = versionNumber(tag);
            break;
        }
    }
    if (!animationVersion) {
        return [];
    }
    reader.u32();
    const count = reader.u32();
    const animations = [];
    for (let index = 0; index < count; index++) {
        let id = 0;
        while (id === 0) {
            id = reader.i32();
        }
        reader.i32();
        let name = reader.string();
        if (!name) {
            name = reader.string();
        }
        const mode = reader.string() || "loop";
        const fps = reader.f32();
        const length = reader.i32();
        reader.i32();
        const trackCount = reader.u32();
        const tracks = [];
        for (let track = 0; track < trackCount; track++) {
            reader.i32();
            const frames = Math.floor(reader.u32() / 36);
            tracks.push(reader.floats(frames * 9));
        }
        if (alt) {
            reader.skip(2);
        }
        else if (animationVersion === 3) {
            reader.skip(1);
        }
        else {
            const extra = reader.u32();
            for (let k = 0; k < extra; k++) {
                reader.f32();
                reader.string();
            }
        }
        animations.push({ id, name, mode, fps, length, tracks });
    }
    return animations;
}
export class MdlParser {
    static parse(bytes) {
        const decoder = new TextDecoder();
        const version = decoder.decode(bytes.subarray(0, 8));
        if (!SUPPORTED_VERSIONS.has(version)) {
            throw new Error(`Unsupported puppet model version: ${version}`);
        }
        try {
            const structured = parseStructured(bytes, version);
            if (structured) {
                return structured;
            }
        }
        catch {
            // Fall through to the heuristic scan below.
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const marker = this.findMarker(bytes, "MDLS", 9);
        // The older formats share the 52-byte vertex.
        const layouts = version === "MDLV0013" || version === "MDLV0016"
            ? [{ stride: 52, uvOffset: 44 }]
            : [
                { stride: 80, uvOffset: 72 },
                { stride: 48, uvOffset: 40 },
            ];
        for (const { stride, uvOffset } of layouts) {
            for (let offset = 9; offset + 12 < marker; offset++) {
                const vertexBytes = view.getUint32(offset + 4, true);
                const vertexOffset = offset + 8;
                const indexLengthOffset = vertexOffset + vertexBytes;
                if (!vertexBytes ||
                    vertexBytes % stride ||
                    indexLengthOffset + 4 > marker) {
                    continue;
                }
                const indexBytes = view.getUint32(indexLengthOffset, true);
                const indexOffset = indexLengthOffset + 4;
                if (!indexBytes || indexBytes % 6 || indexOffset + indexBytes > marker) {
                    continue;
                }
                const vertexCount = vertexBytes / stride;
                const positions = new Float32Array(vertexCount * 2);
                const texCoords = new Float32Array(vertexCount * 2);
                for (let index = 0; index < vertexCount; index++) {
                    const current = vertexOffset + index * stride;
                    positions[index * 2] = view.getFloat32(current, true);
                    positions[index * 2 + 1] = -view.getFloat32(current + 4, true);
                    texCoords[index * 2] = view.getFloat32(current + uvOffset, true);
                    texCoords[index * 2 + 1] = view.getFloat32(current + uvOffset + 4, true);
                }
                const indices = new Uint16Array(indexBytes / 2);
                let valid = true;
                for (let index = 0; index < indices.length; index++) {
                    const value = view.getUint16(indexOffset + index * 2, true);
                    if (value >= vertexCount) {
                        valid = false;
                        break;
                    }
                    indices[index] = value;
                }
                if (!valid) {
                    continue;
                }
                return { indices, positions, texCoords, version };
            }
        }
        throw new Error("Puppet model has no usable mesh");
    }
    static findMarker(bytes, marker, start) {
        const encoded = new TextEncoder().encode(marker);
        for (let offset = start; offset <= bytes.length - encoded.length; offset++) {
            if (encoded.every((value, index) => bytes[offset + index] === value)) {
                return offset;
            }
        }
        return bytes.length;
    }
}
