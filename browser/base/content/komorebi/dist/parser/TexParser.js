/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { decodeDXT, dxtByteLength } from "./DxtDecoder.js";
const TEX_FORMAT = {
    RGBA8888: 0,
    DXT5: 4,
    DXT3: 6,
    DXT1: 7,
};
const LZ4_BULK_COPY_BYTES = 64;
// Atlas images past the first are only kept while their in-memory size (RGBA, or the DXT blocks) stays under this; a long GIF can span dozens of 8K images.
const EXTRA_IMAGE_BUDGET = 640 * 1024 * 1024;
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
        let extraBytes = 0;
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
                let usable = true;
                if (imageIndex > 0) {
                    // Only the base level of an extra image is ever used.
                    const levelBytes = dxtByteLength(format, mipWidth, mipHeight) || mipWidth * mipHeight * 4;
                    usable = mipmapIndex === 0 && extraBytes + levelBytes <= EXTRA_IMAGE_BUDGET;
                    if (usable) {
                        extraBytes += levelBytes;
                    }
                }
                const blocks = !usable
                    ? new Uint8Array(0)
                    : compressed
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
                flags & 4 ? this.readSpriteSheet(primary.width, primary.height) : null;
            return result;
        }
        // DXT stays compressed for the GPU (the uploader decodes it only when the S3TC extension is missing).
        const isDXT = dxtByteLength(format, 1, 1) > 0;
        if (isDXT && blocks.length !== dxtByteLength(format, primary.width, primary.height)) {
            throw new Error(`Invalid DXT texture size: ${blocks.length}/${dxtByteLength(format, primary.width, primary.height)}`);
        }
        const result = {
            compressed: isDXT
                ? { format, levels: images[0].filter(level => level.data.length) }
                : null,
            flags,
            format,
            height,
            images,
            pixels: isDXT ? null : this.decodePixels(format, primary.width, primary.height, blocks),
            textureHeight: primary.height || textureHeight,
            textureWidth: primary.width || textureWidth,
            type: "pixels",
            width,
        };
        // Frame rectangles are in pixels of the stored atlas, whatever the header's texture size says (an animated GIF's header carries the frame size).
        result.spriteSheet =
            flags & 4 ? this.readSpriteSheet(primary.width, primary.height) : null;
        // A frame names the atlas image it lives in; large GIFs span several.
        const decodedImages = images.filter(mipmaps => mipmaps[0].data.length).length;
        let usableImages = decodedImages;
        if (result.spriteSheet?.frames.some(frame => frame.imageIndex > 0)) {
            const extras = [];
            for (const mipmaps of images.slice(1, decodedImages)) {
                try {
                    const level = mipmaps[0];
                    if (isDXT && level.data.length !== dxtByteLength(format, level.width, level.height)) {
                        throw new Error("Invalid DXT texture size");
                    }
                    extras.push({
                        compressed: isDXT ? { format, levels: [level] } : null,
                        pixels: isDXT ? null : this.decodePixels(format, level.width, level.height, level.data),
                        textureHeight: mipmaps[0].height,
                        textureWidth: mipmaps[0].width,
                    });
                }
                catch {
                    break;
                }
            }
            result.extraPixels = extras;
            usableImages = 1 + extras.length;
        }
        if (result.spriteSheet && usableImages < images.length) {
            const frames = result.spriteSheet.frames.filter(frame => frame.imageIndex < usableImages);
            result.spriteSheet = frames.length ? { frames } : null;
        }
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
            const sheetWidth = textureWidth;
            const sheetHeight = textureHeight;
            if (version === "TEXS0003") {
                // The recorded size is that of one frame, not of the atlas.
                this.readUint32();
                this.readUint32();
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
                    imageIndex: frameNumber,
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
            return new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
        }
        if (format === 8 || format === 9) {
            return this.decodeChannels(format === 8 ? 2 : 1, width, height, data);
        }
        if (format !== TEX_FORMAT.DXT1 &&
            format !== TEX_FORMAT.DXT3 &&
            format !== TEX_FORMAT.DXT5) {
            throw new Error(`Unsupported TEX format: ${format}`);
        }
        return decodeDXT(format, width, height, data);
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
            if (literalLength < LZ4_BULK_COPY_BYTES) {
                for (let index = 0; index < literalLength; index++) {
                    output[outputOffset + index] = source[inputOffset + index];
                }
            }
            else {
                output.set(source.subarray(inputOffset, inputOffset + literalLength), outputOffset);
            }
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
            if (matchLength >= LZ4_BULK_COPY_BYTES && matchOffset >= matchLength) {
                output.copyWithin(outputOffset, outputOffset - matchOffset, outputOffset - matchOffset + matchLength);
                outputOffset += matchLength;
            }
            else {
                for (let index = 0; index < matchLength; index++) {
                    output[outputOffset] = output[outputOffset - matchOffset];
                    outputOffset++;
                }
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
