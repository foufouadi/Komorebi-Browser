/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const MAX_TEXTURE_SIDE = 4096;
const MAX_TEXTURE_PIXELS = 12e6;
const SYSTEM_FONTS = new Map([
    ["systemfont_consolas", '"Consolas", "Lucida Console", monospace'],
    ["systemfont_arial", 'Arial, "Liberation Sans", sans-serif'],
    ["systemfont_sansserif", "sans-serif"],
    ["systemfont_comicsans", '"Comic Sans MS", "Comic Neue", cursive'],
]);
// Wallpaper Engine's pointsize is about a quarter of the font size in scene units; measured against Workshop previews.
const POINT_SCALE = 4;
const FALLBACK_FAMILY = "sans-serif";
const ELLIPSIS = "\u2026";
let canvas = null;
let context = null;
let fontCounter = 0;

function scratchContext(width, height) {
    if (!canvas) {
        canvas = document.createElement("canvas");
        context = canvas.getContext("2d", { willReadFrequently: true });
    }
    // Resizing also clears the previous text.
    canvas.width = width;
    canvas.height = height;
    return context;
}

/**
 * Picks the font a text layer draws with: the file the scene names (from the
 * package or the Wallpaper Engine assets, via `readFont`) registered under a
 * private family name, or a system family.
 */
export async function loadTextFont(name, readFont) {
    if (typeof name !== "string" || !name) {
        return { face: null, family: FALLBACK_FAMILY };
    }
    const lower = name.toLowerCase();
    if (lower.startsWith("systemfont_")) {
        return {
            face: null,
            family: SYSTEM_FONTS.get(lower) ?? `"${name.slice(11).replace(/["\\]/g, "")}", ${FALLBACK_FAMILY}`,
        };
    }
    try {
        const data = await readFont(name);
        if (data?.length) {
            const face = new FontFace(`komorebi-text-${++fontCounter}`, repairFont(data));
            await face.load();
            document.fonts.add(face);
            return { face, family: `"${face.family}", ${FALLBACK_FAMILY}` };
        }
    } catch (error) {
        console.warn(`Komorebi could not load the font ${name}`, error);
    }
    return { face: null, family: FALLBACK_FAMILY };
}

/**
 * Returns a copy of the font file `data` with the mistakes fixed that make
 * Firefox's font sanitizer reject the whole font, while Wallpaper Engine
 * loads it.
 */
export function repairFont(data) {
    const bytes = new Uint8Array(data);
    const view = new DataView(bytes.buffer);
    const version = bytes.length >= 12 ? view.getUint32(0) : 0;
    // TrueType, CFF and old Apple TrueType; collections and WOFF are left alone.
    if (version !== 0x00010000 && version !== 0x4f54544f && version !== 0x74727565) {
        return bytes;
    }
    const tables = new Map();
    for (let i = 0, count = view.getUint16(4); i < count; i++) {
        const record = 12 + 16 * i;
        if (record + 16 > bytes.length) {
            break;
        }
        const offset = view.getUint32(record + 8);
        const length = view.getUint32(record + 12);
        if (offset + length <= bytes.length) {
            tables.set(String.fromCharCode(...bytes.subarray(record, record + 4)), { length, offset, record });
        }
    }
    const maxp = tables.get("maxp");
    const glyphs = maxp?.length >= 6 ? view.getUint16(maxp.offset + 4) : 0;
    const cmap = tables.get("cmap");
    if (cmap && glyphs) {
        repairCmap(view, cmap, glyphs);
    }
    repairGlyfLength(view, tables, glyphs);
    const vhea = tables.get("vhea");
    if (vhea?.length >= 4) {
        const vheaVersion = view.getUint32(vhea.offset);
        if (vheaVersion !== 0x00010000 && vheaVersion !== 0x00011000) {
            view.setUint32(vhea.offset, 0x00010000);
        }
    }
    return bytes;
}

// Format 4 subtables that exporters get wrong: a language set outside Mac
// subtables, and a final 0xFFFF segment mapped past the last glyph instead of
// to glyph 0.
function repairCmap(view, { offset, length }, glyphs) {
    const end = offset + length;
    for (let i = 0, count = view.getUint16(offset + 2); i < count; i++) {
        const record = offset + 4 + 8 * i;
        if (record + 8 > end) {
            return;
        }
        const table = offset + view.getUint32(record + 4);
        if (table + 14 > end || view.getUint16(table) !== 4) {
            continue;
        }
        if (view.getUint16(record) !== 1) {
            view.setUint16(table + 4, 0);
        }
        const segments = view.getUint16(table + 6) >> 1;
        const last = 2 * (segments - 1);
        const ends = table + 14;
        const starts = ends + 2 * segments + 2;
        const deltas = starts + 2 * segments;
        const rangeOffsets = deltas + 2 * segments;
        if (
            segments &&
            rangeOffsets + 2 * segments <= end &&
            view.getUint16(ends + last) === 0xffff &&
            view.getUint16(starts + last) === 0xffff &&
            view.getUint16(rangeOffsets + last) === 0 &&
            ((0xffff + view.getInt16(deltas + last)) & 0xffff) >= glyphs
        ) {
            view.setInt16(deltas + last, 1);
        }
    }
}

// Some exporters write a glyf length that runs into the next tables; loca
// gives where the glyph data really ends.
function repairGlyfLength(view, tables, glyphs) {
    const glyf = tables.get("glyf");
    const loca = tables.get("loca");
    const head = tables.get("head");
    if (!glyf || !loca || !head || head.length < 54 || !glyphs) {
        return;
    }
    const long = view.getInt16(head.offset + 50) === 1;
    const last = loca.offset + (long ? 4 : 2) * glyphs;
    if (last + (long ? 4 : 2) > loca.offset + loca.length) {
        return;
    }
    const used = long ? view.getUint32(last) : 2 * view.getUint16(last);
    if (used < glyf.length) {
        view.setUint32(glyf.record + 12, used);
    }
}

export function releaseTextFont(state) {
    if (state.face) {
        document.fonts.delete(state.face);
        state.face = null;
    }
}

/**
 * Picks how many texels the texture of a text layer gets per layout unit: one
 * per scene unit of the layer's on-screen size, more when nothing
 * post-processes it.
 */
export function sizeTextTexture(state, scale, supersample) {
    state.density = [Math.max(0.05, Math.abs(scale[0]) * supersample), Math.max(0.05, Math.abs(scale[1]) * supersample)];
}

// Fits the texture to the box plus its margins, lowering the density when the limits would be exceeded.
function fitTexture(state) {
    const width = state.box[0] + 2 * state.margin[0];
    const height = state.box[1] + 2 * state.margin[1];
    let [densityX, densityY] = state.density;
    const shrink = Math.min(
        1,
        MAX_TEXTURE_SIDE / (width * densityX),
        MAX_TEXTURE_SIDE / (height * densityY),
        Math.sqrt(MAX_TEXTURE_PIXELS / (width * densityX * height * densityY))
    );
    densityX *= shrink;
    densityY *= shrink;
    state.unit = [densityX, densityY];
    state.pixelWidth = Math.max(1, Math.round(width * densityX));
    state.pixelHeight = Math.max(1, Math.round(height * densityY));
}

function wrapLines(ctx, text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
        if (!maxWidth || ctx.measureText(paragraph).width <= maxWidth) {
            lines.push(paragraph);
            continue;
        }
        let line = "";
        for (const word of paragraph.split(/(?<= )/)) {
            if (!line || ctx.measureText(line + word).width <= maxWidth) {
                line += word;
                continue;
            }
            lines.push(line.trimEnd());
            line = word;
        }
        lines.push(line.trimEnd());
    }
    return lines.flatMap(line => breakWide(ctx, line, maxWidth));
}

// A word wider than the limit, or text without spaces, breaks between characters.
function breakWide(ctx, line, maxWidth) {
    if (!maxWidth || ctx.measureText(line).width <= maxWidth) {
        return [line];
    }
    const out = [];
    let current = "";
    for (const character of line) {
        if (current && ctx.measureText(current + character).width > maxWidth) {
            out.push(current);
            current = "";
        }
        current += character;
    }
    out.push(current);
    return out;
}

function fitEllipsis(ctx, line, maxWidth) {
    let text = line.trimEnd();
    while (text && ctx.measureText(text + ELLIPSIS).width > maxWidth) {
        text = [...text].slice(0, -1).join("");
    }
    return text + ELLIPSIS;
}

/**
 * Lays `state.value` out inside the layer's box (in box units, the same ones
 * `size` and `padding` use) and draws it. Wallpaper Engine does not clip text
 * to its box, so the texture grows by a margin on every side (`state.margin`,
 * kept symmetric so the layer stays centred on its origin) when the text
 * overflows; `state.resized` then tells the caller to reallocate the texture
 * and set the layer size to `state.box` plus the margins. Returns the RGBA
 * texels. Text is white (the layer tint colours it) unless the layer has an
 * opaque background, in which case the colours are baked in.
 */
export function rasterizeText(state) {
    const [boxWidth, boxHeight] = state.box;
    const background = state.background;
    const px = state.pointSize * POINT_SCALE;
    const font = `${px}px ${state.family}`;
    let ctx = scratchContext(1, 1);
    ctx.font = font;
    const metrics = ctx.measureText("Mg");
    const ascent = metrics.fontBoundingBoxAscent ?? px * 0.8;
    const lineHeight = ascent + (metrics.fontBoundingBoxDescent ?? px * 0.2);
    const wrapWidth = state.maxWidth;
    let lines = state.value ? wrapLines(ctx, state.value, wrapWidth) : [];
    if (state.maxRows && lines.length > state.maxRows) {
        lines = lines.slice(0, state.maxRows);
        if (state.ellipsis && wrapWidth) {
            lines[lines.length - 1] = fitEllipsis(ctx, lines[lines.length - 1], wrapWidth);
        }
    }
    let widest = 0;
    for (const line of lines) {
        widest = Math.max(widest, ctx.measureText(line).width);
    }
    const [paddingX, paddingY] = state.padding;
    const block = lines.length * lineHeight;
    let top = paddingY;
    if (state.vertical === "center") {
        top = (boxHeight - block) / 2;
    } else if (state.vertical === "bottom") {
        top = boxHeight - paddingY - block;
    }
    let x = paddingX;
    let align = "left";
    let left = x;
    if (state.horizontal === "center") {
        x = boxWidth / 2;
        align = "center";
        left = x - widest / 2;
    } else if (state.horizontal === "right") {
        x = boxWidth - paddingX;
        align = "right";
        left = x - widest;
    }
    const slack = px * 0.1;
    const overflowX = Math.max(0, -left, left + widest - boxWidth);
    const overflowY = Math.max(0, -top, top + block - boxHeight);
    const needX = overflowX ? overflowX + slack : 0;
    const needY = overflowY ? overflowY + slack : 0;
    if (needX > state.margin[0] || needY > state.margin[1]) {
        // Headroom, so a string that keeps changing does not reallocate every time.
        state.margin = [needX > state.margin[0] ? needX * 1.25 : state.margin[0], needY > state.margin[1] ? needY * 1.25 : state.margin[1]];
        state.resized = true;
    }
    fitTexture(state);
    const { pixelWidth: width, pixelHeight: height } = state;
    ctx = scratchContext(width, height);
    ctx.setTransform(state.unit[0], 0, 0, state.unit[1], state.margin[0] * state.unit[0], state.margin[1] * state.unit[1]);
    if (background) {
        ctx.fillStyle = toCss(background);
        ctx.fillRect(0, 0, boxWidth, boxHeight);
    }
    ctx.font = font;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = align;
    ctx.fillStyle = background ? toCss(state.color) : "#fff";
    lines.forEach((line, index) => ctx.fillText(line, x, top + ascent + index * lineHeight));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const image = ctx.getImageData(0, 0, width, height);
    if (!background) {
        // Fully transparent texels are black; filtering would darken the glyph edges toward them.
        const texels = new Uint32Array(image.data.buffer);
        for (let index = 0; index < texels.length; index++) {
            texels[index] |= 0x00ffffff;
        }
    }
    return new Uint8Array(image.data.buffer);
}

function toCss(color) {
    const channel = value => Math.round(Math.min(1, Math.max(0, value)) * 255);
    return `rgb(${channel(color[0])} ${channel(color[1])} ${channel(color[2])})`;
}
