import { BinaryReader } from "./BinaryReader.js";
const VERSION_PATTERN = /^PKGV\d{4}$/;
export class PackageReader {
    static parse(bytes, sceneFile) {
        const reader = new BinaryReader(bytes);
        let offset = 0;
        const readUint32 = () => {
            if (offset + 4 > bytes.length) {
                throw new Error("Unexpected end of scene package");
            }
            const value = reader.view.getUint32(offset, true);
            offset += 4;
            return value;
        };
        const readString = () => {
            const length = readUint32();
            if (length > bytes.length - offset) {
                throw new Error("Invalid scene package string");
            }
            const value = new TextDecoder().decode(bytes.subarray(offset, offset + length));
            offset += length;
            return value;
        };
        const directVersion = new TextDecoder().decode(bytes.subarray(0, 8));
        let version;
        if (VERSION_PATTERN.test(directVersion)) {
            version = directVersion;
            offset = bytes[8] === 0 ? 9 : 8;
        }
        else {
            version = readString();
        }
        if (!VERSION_PATTERN.test(version)) {
            throw new Error(`Unsupported scene package version: ${version}`);
        }
        const count = readUint32();
        if (!count || count > 100000) {
            throw new Error(`Invalid scene package entry count: ${count}`);
        }
        const entries = [];
        for (let index = 0; index < count; index++) {
            entries.push({
                name: readString(),
                offset: readUint32(),
                length: readUint32(),
            });
        }
        const dataOffset = offset;
        const files = new Map();
        for (const entry of entries) {
            if (entry.offset > bytes.length - dataOffset ||
                entry.length > bytes.length - dataOffset - entry.offset) {
                throw new Error(`Invalid scene package entry: ${entry.name}`);
            }
            files.set(entry.name, bytes.slice(dataOffset + entry.offset, dataOffset + entry.offset + entry.length));
        }
        const sceneBytes = files.get(sceneFile);
        if (!sceneBytes) {
            throw new Error(`Scene package has no ${sceneFile}`);
        }
        return {
            entries: files,
            scene: JSON.parse(new TextDecoder().decode(sceneBytes)),
            version,
        };
    }
}
