const TEX_FORMAT = {
    RGBA8888: 0,
    DXT5: 4,
    DXT3: 6,
    DXT1: 7,
};
export class TexParser {
    bytes;
    view;
    offset;
    constructor(bytes) {
        if (!(bytes instanceof Uint8Array)) {
            throw new TypeError("TexParser expects a Uint8Array");
        }
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.offset = 0;
    }
    parse() {
        if (this.readCString() !== "TEXV0005") {
            throw new Error("Unsupported texture version");
        }
        if (this.readCString() !== "TEXI0001") {
            throw new Error("Unsupported texture header");
        }
        const format = this.readUint32();
        const flags = this.readUint32();
        const textureWidth = this.readUint32();
        const textureHeight = this.readUint32();
        const width = this.readUint32();
        const height = this.readUint32();
        this.readUint32();
        const container = this.readCString();
        const version = Number(container.slice(4));
        if (!container.startsWith("TEXB") || version < 1 || version > 4) {
            throw new Error(`Unsupported texture container: ${container}`);
        }
        const imageCount = this.readUint32();
        let imageFormat = -1;
        if (version >= 3) {
            imageFormat = this.readInt32();
            if (version === 4) {
                const isVideo = this.readUint32() === 1;
                if (imageFormat === -1 && isVideo) {
                    imageFormat = 35;
                }
            }
        }
        if (!imageCount) {
            throw new Error("Texture contains no images");
        }
        const mipmapVersion = version === 4 && imageFormat !== 35 ? 3 : version;
        const images = [];
        for (let imageIndex = 0; imageIndex < imageCount; imageIndex++) {
            const mipmapCount = this.readUint32();
            if (!mipmapCount) {
                throw new Error("Texture contains no mipmaps");
            }
            const mipmaps = [];
            for (let mipmapIndex = 0; mipmapIndex < mipmapCount; mipmapIndex++) {
                if (mipmapVersion === 4) {
                    this.readUint32();
                    this.readUint32();
                    this.readCString();
                    this.readUint32();
                }
                const mipWidth = this.readUint32();
                const mipHeight = this.readUint32();
                let compressed = false;
                let decompressedLength = 0;
                if (mipmapVersion >= 2) {
                    compressed = this.readUint32() === 1;
                    decompressedLength = this.readInt32();
                }
                const byteLength = this.readInt32();
                if (byteLength < 0 || decompressedLength < 0) {
                    throw new Error("Invalid texture mipmap length");
                }
                const data = this.readBytes(byteLength);
                const blocks = compressed
                    ? this.decompressLZ4(data, decompressedLength)
                    : data;
                mipmaps.push({ data: blocks, height: mipHeight, width: mipWidth });
            }
            images.push(mipmaps);
        }
        const primary = images[0][0];
        const blocks = primary.data;
        if (this.isMP4(blocks)) {
            return {
                data: blocks,
                flags,
                height,
                mimeType: "video/mp4",
                type: "video",
                width,
                images,
            };
        }
        if (imageFormat !== -1) {
            const result = {
                data: blocks,
                flags,
                height,
                imageFormat,
                mimeType: this.getMimeType(imageFormat),
                type: imageFormat === 35 ? "video" : "image",
                width,
                images,
            };
            result.spriteSheet =
                flags & 4 ? this.readSpriteSheet(textureWidth, textureHeight) : null;
            return result;
        }
        const result = {
            flags,
            format,
            height,
            images,
            pixels: this.decodePixels(format, primary.width, primary.height, blocks),
            textureHeight: primary.height || textureHeight,
            textureWidth: primary.width || textureWidth,
            type: "pixels",
            width,
        };
        result.spriteSheet =
            flags & 4 ? this.readSpriteSheet(textureWidth, textureHeight) : null;
        return result;
    }
    isMP4(data) {
        return (data.length >= 12 &&
            data[4] === 0x66 &&
            data[5] === 0x74 &&
            data[6] === 0x79 &&
            data[7] === 0x70);
    }
    readSpriteSheet(textureWidth, textureHeight) {
        if (this.offset >= this.bytes.length) {
            return null;
        }
        const start = this.offset;
        try {
            const version = this.readCString();
            if (!/^TEXS000[123]$/.test(version)) {
                this.offset = start;
                return null;
            }
            const count = this.readUint32();
            let sheetWidth = textureWidth;
            let sheetHeight = textureHeight;
            if (version === "TEXS0003") {
                sheetWidth = this.readUint32();
                sheetHeight = this.readUint32();
            }
            if (!count ||
                count > 10000 ||
                this.offset + count * 32 > this.bytes.length) {
                throw new Error("Invalid texture sprite sheet");
            }
            const frames = [];
            for (let index = 0; index < count; index++) {
                let frameNumber;
                let duration;
                let x;
                let y;
                let width1;
                let width2;
                let height2;
                let height1;
                if (version === "TEXS0001") {
                    frameNumber = this.readUint32();
                    duration = this.readFloat32();
                    x = this.readUint32();
                    y = this.readUint32();
                    width1 = this.readUint32();
                    width2 = this.readUint32();
                    height2 = this.readUint32();
                    height1 = this.readUint32();
                }
                else {
                    frameNumber = this.readUint32();
                    duration = this.readFloat32();
                    x = this.readFloat32();
                    y = this.readFloat32();
                    width1 = this.readFloat32();
                    width2 = this.readFloat32();
                    height2 = this.readFloat32();
                    height1 = this.readFloat32();
                }
                const translation = [x / sheetWidth, y / sheetHeight];
                const rotation = [
                    width1 / sheetWidth,
                    width2 / sheetWidth,
                    height2 / sheetHeight,
                    height1 / sheetHeight,
                ];
                frames.push({
                    bottom: translation[1] + rotation[3],
                    duration: Math.max(duration, 1 / 60),
                    frameNumber,
                    left: translation[0],
                    right: translation[0] + rotation[0],
                    rotation,
                    top: translation[1],
                    translation,
                });
            }
            return { frames };
        }
        catch (error) {
            this.offset = start;
            console.error("Komorebi could not parse texture animation", error);
            return null;
        }
    }
    getMimeType(format) {
        const types = new Map([
            [0, "image/bmp"],
            [2, "image/jpeg"],
            [13, "image/png"],
            [25, "image/gif"],
            [35, "video/mp4"],
        ]);
        const type = types.get(format);
        if (!type) {
            throw new Error(`Unsupported encoded image format: ${format}`);
        }
        return type;
    }
    decodePixels(format, width, height, data) {
        if (format === TEX_FORMAT.RGBA8888) {
            const expectedLength = width * height * 4;
            if (data.length !== expectedLength) {
                throw new Error(`Invalid RGBA texture size: ${data.length}/${expectedLength}`);
            }
            return new Uint8ClampedArray(data);
        }
        if (format === 8 || format === 9) {
            return this.decodeChannels(format === 8 ? 2 : 1, width, height, data);
        }
        if (format !== TEX_FORMAT.DXT1 &&
            format !== TEX_FORMAT.DXT3 &&
            format !== TEX_FORMAT.DXT5) {
            throw new Error(`Unsupported TEX format: ${format}`);
        }
        const pixels = new Uint8ClampedArray(width * height * 4);
        const blockSize = format === TEX_FORMAT.DXT1 ? 8 : 16;
        const expectedLength = Math.ceil(width / 4) * Math.ceil(height / 4) * blockSize;
        if (data.length !== expectedLength) {
            throw new Error(`Invalid DXT texture size: ${data.length}/${expectedLength}`);
        }
        let offset = 0;
        for (let blockY = 0; blockY < Math.ceil(height / 4); blockY++) {
            for (let blockX = 0; blockX < Math.ceil(width / 4); blockX++) {
                const alpha = this.decodeAlpha(format, data, offset);
                const colorOffset = offset + (format === TEX_FORMAT.DXT1 ? 0 : 8);
                this.decodeColorBlock(data, colorOffset, pixels, width, height, blockX, blockY, alpha, format === TEX_FORMAT.DXT1);
                offset += blockSize;
            }
        }
        return pixels;
    }
    decodeChannels(channelCount, width, height, data) {
        const expectedLength = width * height * channelCount;
        if (data.length !== expectedLength) {
            throw new Error(`Invalid ${channelCount === 1 ? "R8" : "RG8"} texture size: ${data.length}/${expectedLength}`);
        }
        const pixels = new Uint8ClampedArray(width * height * 4);
        for (let source = 0, destination = 0; source < data.length;) {
            const red = data[source++];
            const green = channelCount === 2 ? data[source++] : red;
            pixels[destination++] = red;
            pixels[destination++] = green;
            pixels[destination++] = channelCount === 1 ? red : 0;
            pixels[destination++] = 255;
        }
        return pixels;
    }
    decodeAlpha(format, data, offset) {
        if (format === TEX_FORMAT.DXT1) {
            return null;
        }
        const values = new Uint8Array(16);
        if (format === TEX_FORMAT.DXT3) {
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
    decodeColorBlock(data, offset, pixels, width, height, blockX, blockY, alpha, allowTransparency) {
        const color0 = data[offset] | (data[offset + 1] << 8);
        const color1 = data[offset + 2] | (data[offset + 3] << 8);
        const colors = [this.decode565(color0), this.decode565(color1)];
        if (color0 > color1 || !allowTransparency) {
            colors.push(this.mix(colors[0], colors[1], 2, 1, 3));
            colors.push(this.mix(colors[0], colors[1], 1, 2, 3));
        }
        else {
            colors.push(this.mix(colors[0], colors[1], 1, 1, 2));
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
    decode565(value) {
        return [
            Math.round(((value >> 11) & 31) * (255 / 31)),
            Math.round(((value >> 5) & 63) * (255 / 63)),
            Math.round((value & 31) * (255 / 31)),
            255,
        ];
    }
    mix(first, second, firstWeight, secondWeight, divisor) {
        return [
            Math.round((first[0] * firstWeight + second[0] * secondWeight) / divisor),
            Math.round((first[1] * firstWeight + second[1] * secondWeight) / divisor),
            Math.round((first[2] * firstWeight + second[2] * secondWeight) / divisor),
            255,
        ];
    }
    decompressLZ4(source, outputLength) {
        const output = new Uint8Array(outputLength);
        let inputOffset = 0;
        let outputOffset = 0;
        while (inputOffset < source.length) {
            const token = source[inputOffset++];
            let literalLength = token >> 4;
            if (literalLength === 15) {
                let value;
                do {
                    value = source[inputOffset++];
                    literalLength += value;
                } while (value === 255);
            }
            output.set(source.subarray(inputOffset, inputOffset + literalLength), outputOffset);
            inputOffset += literalLength;
            outputOffset += literalLength;
            if (inputOffset >= source.length) {
                break;
            }
            const matchOffset = source[inputOffset] | (source[inputOffset + 1] << 8);
            inputOffset += 2;
            let matchLength = token & 15;
            if (matchLength === 15) {
                let value;
                do {
                    value = source[inputOffset++];
                    matchLength += value;
                } while (value === 255);
            }
            matchLength += 4;
            for (let index = 0; index < matchLength; index++) {
                output[outputOffset] = output[outputOffset - matchOffset];
                outputOffset++;
            }
        }
        if (outputOffset !== outputLength) {
            throw new Error("Invalid LZ4 texture payload");
        }
        return output;
    }
    readBytes(length) {
        if (length < 0 || this.offset + length > this.bytes.length) {
            throw new Error("Unexpected end of texture");
        }
        const value = this.bytes.slice(this.offset, this.offset + length);
        this.offset += length;
        return value;
    }
    readCString() {
        const start = this.offset;
        while (this.offset < this.bytes.length && this.bytes[this.offset]) {
            this.offset++;
        }
        if (this.offset >= this.bytes.length) {
            throw new Error("Unterminated texture header");
        }
        const value = new TextDecoder().decode(this.bytes.subarray(start, this.offset));
        this.offset++;
        return value;
    }
    readUint32() {
        if (this.offset + 4 > this.bytes.length) {
            throw new Error("Unexpected end of texture");
        }
        const value = this.view.getUint32(this.offset, true);
        this.offset += 4;
        return value;
    }
    readInt32() {
        if (this.offset + 4 > this.bytes.length) {
            throw new Error("Unexpected end of texture");
        }
        const value = this.view.getInt32(this.offset, true);
        this.offset += 4;
        return value;
    }
    readFloat32() {
        if (this.offset + 4 > this.bytes.length) {
            throw new Error("Unexpected end of texture");
        }
        const value = this.view.getFloat32(this.offset, true);
        this.offset += 4;
        return value;
    }
}
