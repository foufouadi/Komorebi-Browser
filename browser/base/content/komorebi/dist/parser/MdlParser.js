const SUPPORTED_VERSIONS = new Set([
    "MDLV0016",
    "MDLV0017",
    "MDLV0019",
    "MDLV0021",
    "MDLV0023",
]);
export class MdlParser {
    static parse(bytes) {
        const decoder = new TextDecoder();
        const version = decoder.decode(bytes.subarray(0, 8));
        if (!SUPPORTED_VERSIONS.has(version)) {
            throw new Error(`Unsupported puppet model version: ${version}`);
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const marker = this.findMarker(bytes, "MDLS", 9);
        const layouts = version === "MDLV0016"
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
