/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { PackageReader } from "../io/PackageReader.js";
import { createDynamicBuffer, createStaticBuffer } from "../graphics/BufferUtils.js";
import { loadTextFont, rasterizeText, sizeTextTexture } from "../graphics/TextRasterizer.js";
import { collectIncludeNames } from "../parser/ShaderIncludes.js";
import { PuppetAnimator, fillPuppetArrays } from "./PuppetAnimator.js";
import { SceneModel } from "./SceneModel.js";
import { TexParser } from "../parser/TexParser.js";
function numberLines(source) {
    // GLSL "line:column" errors are 1-indexed, matching this.
    return source
        .split("\n")
        .map((line, index) => `${index + 1}: ${line}`)
        .join("\n");
}
// Scene values bound to a project property ({"user": "name", "value": baked}) follow that property's current value; the baked one is only what the editor last saw.
function applyUserProperties(node, properties) {
    if (Array.isArray(node)) {
        for (const item of node) {
            applyUserProperties(item, properties);
        }
        return;
    }
    if (!node || typeof node !== "object") {
        return;
    }
    const name = typeof node.user === "string" ? node.user : node.user?.name;
    if (name !== undefined && "value" in node && properties.has(name)) {
        const property = properties.get(name);
        const condition = node.user?.condition;
        node.value = condition === undefined ? property : String(property) === String(condition);
    }
    for (const child of Object.values(node)) {
        applyUserProperties(child, properties);
    }
}
const VIDEO_SIGNATURE_SAMPLES = 16;
const VIDEO_SIGNATURE_SAMPLE_BYTES = 8;
function videoSignature(data) {
    const parts = [data.length];
    for (let sample = 0; sample < VIDEO_SIGNATURE_SAMPLES; sample++) {
        const offset = Math.floor(((data.length - VIDEO_SIGNATURE_SAMPLE_BYTES) * sample) /
            (VIDEO_SIGNATURE_SAMPLES - 1));
        const start = Math.max(0, offset);
        parts.push(data.subarray(start, start + VIDEO_SIGNATURE_SAMPLE_BYTES).join(","));
    }
    return parts.join("|");
}
export class SceneLoader {
    #graphics;
    #assetRoot = null;
    #entries = new Map();
    #fonts = new Map();
    #videos = new Map();
    constructor(graphics) {
        this.#graphics = graphics;
    }
    async load(packageSource, sceneFile, assetRoot, isCancelled) {
        try {
            return await this.#load(packageSource, sceneFile, assetRoot, isCancelled);
        }
        finally {
            this.#assetRoot = null;
            this.#entries = new Map();
            this.#fonts = new Map();
            this.#videos = new Map();
        }
    }
    async #load(packageSource, sceneFile, assetRoot, isCancelled) {
        this.#assetRoot = assetRoot;
        const pkg = await this.readPackage(packageSource, sceneFile);
        const properties = await this.readUserProperties(packageSource);
        if (properties.size) {
            applyUserProperties(pkg.scene, properties);
        }
        await this.loadExternalTextures(pkg, assetRoot);
        // Must complete before SceneModel/MaterialParser compile any shader (ShaderParser.compile is synchronous).
        await this.loadExternalShaders(pkg, assetRoot);
        await this.loadDefaultTextures(pkg, assetRoot);
        this.#entries = pkg.entries;
        if (isCancelled()) {
            return null;
        }
        await new Promise(resolve => setTimeout(resolve));
        if (isCancelled()) {
            return null;
        }
        const sceneModel = new SceneModel(pkg);
        const layers = sceneModel.createLayers();
        if (!layers.length) {
            // A 3D scene is made of mesh models with a perspective camera, none of which this 2D renderer draws.
            const is3D = pkg.scene.objects?.some(object => object.model);
            throw new Error(is3D
                ? `Scene is 3D, which is not supported (${packageSource})`
                : `Scene has no drawable layer (${packageSource})`);
        }
        if (isCancelled()) {
            return null;
        }
        const preparedLayers = await this.prepareLayers(layers, isCancelled, sceneModel.captureSize);
        if (!preparedLayers) {
            return null;
        }
        const preparedParticles = await this.prepareParticles(sceneModel.particles);
        const userProperties = {};
        for (const [name, value] of properties) {
            if (["number", "boolean", "string"].includes(typeof value)) {
                userProperties[name] = value;
            }
        }
        return { sceneModel, layers: preparedLayers, particles: preparedParticles, userProperties };
    }
    async readUserProperties(packageSource) {
        const properties = new Map();
        try {
            const project = JSON.parse(new TextDecoder().decode(new Uint8Array(await this.fetchPackage(new URL("project.json", packageSource).href))));
            for (const [name, property] of Object.entries(project.general?.properties ?? {})) {
                if (property && property.value !== undefined && property.type !== "scenetexture") {
                    properties.set(name, property.value);
                }
            }
        }
        catch { }
        return properties;
    }
    async loadExternalTextures(pkg, assetRoot) {
        if (!assetRoot) {
            return;
        }
        const names = new Set();
        for (const [path, content] of pkg.entries) {
            if (!path.toLowerCase().endsWith(".json")) {
                continue;
            }
            try {
                this.collectTextureNames(JSON.parse(new TextDecoder().decode(content)), names);
            }
            catch { }
        }
        await this.fetchTextures(pkg, names, assetRoot);
    }
    // A shader can name a stock texture as the default of a sampler (`"default":"util/noise"`) without any material mentioning it.
    async loadDefaultTextures(pkg, assetRoot) {
        if (!assetRoot) {
            return;
        }
        const names = new Set();
        const decoder = new TextDecoder();
        for (const [path, content] of pkg.entries) {
            if (!/^shaders\/.*\.(?:frag|vert)$/i.test(path)) {
                continue;
            }
            for (const match of decoder.decode(content).matchAll(/uniform\s+sampler2D\s+g_Texture\d+\s*;\s*\/\/\s*(\{.+\})/g)) {
                try {
                    const name = JSON.parse(match[1]).default;
                    if (typeof name === "string" && name && !name.startsWith("_") && !name.toLowerCase().endsWith(".tex")) {
                        names.add(name);
                    }
                }
                catch { }
            }
        }
        await this.fetchTextures(pkg, names, assetRoot);
    }
    async fetchTextures(pkg, names, assetRoot) {
        await Promise.all([...names].map(async (name) => {
            const normalized = name.replaceAll("\\", "/").replace(/^\/+/, "");
            if (normalized.split("/").includes("..")) {
                return;
            }
            const entryPath = `materials/${normalized}.tex`;
            if (this.findEntry(pkg.entries, entryPath)) {
                return;
            }
            try {
                const source = new URL(`materials/${normalized}.tex`, assetRoot)
                    .href;
                pkg.entries.set(entryPath, new Uint8Array(await this.fetchPackage(source)));
            }
            catch { }
        }));
    }
    /**
     * Fetches shader sources missing from the .pkg (effect/pass shaders, and
     * the "common*.h" standard-library headers they `#include`) from the local
     * Wallpaper Engine install, following `#include` directives transitively
     * until no new dependency is discovered. Most wallpapers only embed the
     * .vert/.frag files for their own passes and rely on the stock headers
     * shipped with the Wallpaper Engine install (see
     * docs/rapport-shaders-stock-manquants.md).
     */
    async loadExternalShaders(pkg, assetRoot) {
        if (!assetRoot) {
            return;
        }
        const shaderNames = new Set();
        for (const [path, content] of pkg.entries) {
            if (!path.toLowerCase().endsWith(".json")) {
                continue;
            }
            try {
                this.collectShaderNames(JSON.parse(new TextDecoder().decode(content)), shaderNames);
            }
            catch { }
        }
        const worklist = [];
        for (const name of shaderNames) {
            worklist.push(`shaders/${name}.vert`, `shaders/${name}.frag`);
        }
        for (const path of pkg.entries.keys()) {
            if (path.toLowerCase().startsWith("shaders/")) {
                worklist.push(path);
            }
        }
        const decoder = new TextDecoder();
        const visited = new Set();
        while (worklist.length) {
            const path = worklist.pop();
            if (visited.has(path)) {
                continue;
            }
            visited.add(path);
            let content = this.findEntry(pkg.entries, path);
            if (!content) {
                const relative = path.replace(/^shaders\//i, "");
                if (relative.split(/[\\/]/).includes("..")) {
                    continue;
                }
                try {
                    const source = new URL(`shaders/${relative}`, assetRoot).href;
                    const fetched = new Uint8Array(await this.fetchPackage(source));
                    if (!fetched.length) {
                        continue;
                    }
                    content = fetched;
                    pkg.entries.set(path, content);
                }
                catch {
                    continue;
                }
            }
            let text;
            try {
                text = decoder.decode(content);
            }
            catch {
                continue;
            }
            for (const name of collectIncludeNames(text)) {
                worklist.push(`shaders/${name}`);
            }
        }
    }
    collectShaderNames(value, names) {
        if (Array.isArray(value)) {
            for (const item of value) {
                this.collectShaderNames(item, names);
            }
            return;
        }
        if (!value || typeof value !== "object") {
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            if (key === "shader" && typeof child === "string" && child) {
                names.add(child);
            }
            else {
                this.collectShaderNames(child, names);
            }
        }
    }
    collectTextureNames(value, names) {
        if (Array.isArray(value)) {
            for (const item of value) {
                this.collectTextureNames(item, names);
            }
            return;
        }
        if (!value || typeof value !== "object") {
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            if (key === "textures" && Array.isArray(child)) {
                for (const texture of child) {
                    if (typeof texture === "string" &&
                        !texture.startsWith("_") &&
                        !texture.toLowerCase().endsWith(".tex")) {
                        names.add(texture);
                    }
                }
            }
            else {
                this.collectTextureNames(child, names);
            }
        }
    }
    findEntry(entries, path) {
        const lowerPath = path.toLowerCase();
        for (const [entryPath, content] of entries) {
            if (entryPath.toLowerCase() === lowerPath) {
                return content;
            }
        }
        return null;
    }
    async prepareLayers(layers, isCancelled, captureSize) {
        // Only the awaits (image decoding) overlap. Every GL call sits in a
        // synchronous stretch that binds what it needs, and each layer owns
        // its own texture cache, so interleaving layers is safe.
        const preparedLayers = await Promise.all(layers.map(async (layer) => {
            if (isCancelled()) {
                return null;
            }
            if (layer.text) {
                await this.prepareText(layer);
            }
            const preparedLayer = {
                ...layer,
                ...(await this.uploadTexture(layer.texture)),
            };
            if (layer.passthrough) {
                // It filters the scene capture instead of a texture of its own.
                [preparedLayer.width, preparedLayer.height] = captureSize;
                [preparedLayer.textureWidth, preparedLayer.textureHeight] = captureSize;
                preparedLayer.u = 1;
                preparedLayer.v = 1;
            }
            if (layer.texture.extraPixels) {
                const { flags, width, height } = layer.texture;
                const extras = layer.texture.extraPixels.splice(0);
                preparedLayer.imageTextures = [
                    preparedLayer.glTexture,
                    ...extras.map(extra => this.#graphics.textures.upload({ ...extra, flags, width, height }).glTexture),
                ];
            }
            delete preparedLayer.texture;
            this.preparePuppet(preparedLayer);
            await this.prepareMaterialPasses(preparedLayer);
            return preparedLayer;
        }));
        if (isCancelled() || preparedLayers.includes(null)) {
            return null;
        }
        return preparedLayers;
    }
    // Renders the layer's first string into its texture; SceneRenderer redraws it when the string changes.
    async prepareText(layer) {
        const state = layer.text;
        let font = this.#fonts.get(state.font);
        if (!font) {
            font = loadTextFont(state.font, name => this.readFont(name));
            this.#fonts.set(state.font, font);
        }
        ({ face: state.face, family: state.family } = await font);
        sizeTextTexture(state, layer.scale, layer.renderPasses.length ? 1 : 2);
        const pixels = rasterizeText(state);
        state.dirty = false;
        state.resized = false;
        layer.size = [state.box[0] + 2 * state.margin[0], state.box[1] + 2 * state.margin[1]];
        layer.texture = {
            flags: 2,
            format: 0,
            height: state.pixelHeight,
            pixels,
            textureHeight: state.pixelHeight,
            textureWidth: state.pixelWidth,
            type: "pixels",
            width: state.pixelWidth,
        };
    }
    async readFont(name) {
        const normalized = name.replaceAll("\\", "/").replace(/^\/+/, "");
        const entry = this.findEntry(this.#entries, normalized);
        if (entry) {
            return entry;
        }
        if (!this.#assetRoot || normalized.split("/").includes("..")) {
            return null;
        }
        try {
            return new Uint8Array(await this.fetchPackage(new URL(normalized, this.#assetRoot).href));
        }
        catch {
            return null;
        }
    }
    async prepareParticles(particles) {
        return Promise.all(particles.map(async (particle) => {
            const prepared = {
                ...particle,
                ...(await this.uploadTexture(particle.texture)),
            };
            delete prepared.texture;
            return prepared;
        }));
    }
    preparePuppet(layer) {
        if (!layer.puppet) {
            return;
        }
        const gl = this.#graphics.gl;
        const positions = new Float32Array(layer.puppet.positions.length);
        const effectPositions = new Float32Array(layer.puppet.positions.length * 1.5);
        // Where each vertex landed inside the first pass's render target: the final draw samples it there, not at the mesh's atlas UVs.
        const outputTexCoords = new Float32Array(layer.puppet.positions.length);
        // layer.puppet.positions[y] already carries MdlParser's Y-down flip; do not re-negate here or the mesh renders upside down.
        fillPuppetArrays(layer, layer.puppet.positions, positions, effectPositions, outputTexCoords);
        const skeleton = layer.puppet.skeleton;
        const animator = skeleton
            ? new PuppetAnimator(skeleton, layer.animationLayers)
            : null;
        const createBuffer = animator?.active ? createDynamicBuffer : createStaticBuffer;
        if (animator?.active) {
            layer.puppetAnimation = {
                animator,
                skinned: new Float32Array(layer.puppet.positions.length),
                positions,
                effectPositions,
                outputTexCoords,
            };
        }
        layer.puppetPositionBuffer = createBuffer(gl, positions);
        layer.puppetEffectPositionBuffer = createBuffer(gl, effectPositions);
        layer.puppetTexCoordBuffer = createStaticBuffer(gl, layer.puppet.texCoords);
        layer.puppetOutputTexCoordBuffer = createBuffer(gl, outputTexCoords);
        layer.puppetIndexBuffer = createStaticBuffer(gl, layer.puppet.indices, gl.ELEMENT_ARRAY_BUFFER);
        layer.puppetIndexCount = layer.puppet.indices.length;
    }
    async prepareMaterialPasses(layer) {
        const textures = new Map();
        for (const pass of layer.renderPasses) {
            try {
                pass.program = this.#graphics.programs.get(pass.vertex, pass.fragment);
                pass.resolvedTextures = new Map();
                for (const [index, name] of pass.textures) {
                    if (index === 0 ||
                        name.startsWith("_rt_") ||
                        name.startsWith("_alias_")) {
                        continue;
                    }
                    let texture = textures.get(name);
                    if (!texture) {
                        const parsed = this.resolvePassTexture(name);
                        if (!parsed) {
                            continue;
                        }
                        texture = await this.uploadTexture(parsed);
                        textures.set(name, texture);
                    }
                    pass.resolvedTextures.set(index, texture);
                }
                this.preparePassTarget(layer, pass);
            }
            catch (error) {
                pass.error = error;
                console.error(`Komorebi could not compile shader ${pass.shader}`, error);
                // GLSL errors reference line numbers into the composed source, not the original .frag/.vert file.
                console.groupCollapsed(`Komorebi composed shader source for ${pass.shader}`);
                console.log("-- vertex --\n" + numberLines(pass.vertex));
                console.log("-- fragment --\n" + numberLines(pass.fragment));
                console.groupEnd();
            }
        }
    }
    preparePassTarget(layer, pass) {
        const gl = this.#graphics.gl;
        const outputTexture = gl.createTexture();
        if (!outputTexture) {
            throw new Error("Failed to create WebGL texture");
        }
        gl.bindTexture(gl.TEXTURE_2D, outputTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, layer.width, layer.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        pass.outputTexture = outputTexture;
        pass.outputWidth = layer.width;
        pass.outputHeight = layer.height;
        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) {
            throw new Error("Failed to create WebGL framebuffer");
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outputTexture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Incomplete framebuffer for ${pass.shader}`);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        pass.framebuffer = framebuffer;
    }
    resolvePassTexture(name) {
        const normalized = name.replaceAll("\\", "/");
        const paths = normalized.endsWith(".tex")
            ? [normalized]
            : [`${normalized}.tex`, `materials/${normalized}.tex`];
        const lowerPaths = new Set(paths.map(path => path.toLowerCase()));
        for (const [path, content] of this.#entries) {
            if (!lowerPaths.has(path.toLowerCase())) {
                continue;
            }
            try {
                return new TexParser(content).parse();
            }
            catch (error) {
                console.error(`Komorebi could not decode ${path}`, error);
                return null;
            }
        }
        return null;
    }
    async uploadTexture(texture) {
        if (texture.type === "video") {
            return this.uploadVideoTexture(texture);
        }
        const asset = await this.prepareTexture(texture);
        try {
            return this.#graphics.textures.upload(asset);
        }
        finally {
            asset.bitmap?.close();
            texture.pixels = null;
        }
    }
    async uploadVideoTexture(texture) {
        const data = texture.data;
        texture.data = null;
        const signature = videoSignature(data);
        let shared = this.#videos.get(signature);
        if (!shared) {
            shared = this.createSharedVideo(texture, data);
            this.#videos.set(signature, shared);
        }
        const uploaded = await shared;
        const width = texture.width || uploaded.textureWidth;
        const height = texture.height || uploaded.textureHeight;
        return {
            ...uploaded,
            height,
            u: width / uploaded.textureWidth,
            v: height / uploaded.textureHeight,
            width,
        };
    }
    async createSharedVideo(texture, data) {
        const asset = await this.prepareVideoTexture(texture, data);
        return this.#graphics.textures.upload(asset);
    }
    async prepareTexture(texture) {
        if (texture.type !== "image") {
            return texture;
        }
        const data = texture.data;
        texture.data = null;
        const bitmap = await createImageBitmap(new Blob([data], { type: texture.mimeType }));
        return {
            bitmap,
            flags: texture.flags,
            height: bitmap.height,
            spriteSheet: texture.spriteSheet ?? undefined,
            textureHeight: bitmap.height,
            textureWidth: bitmap.width,
            width: bitmap.width,
        };
    }
    async prepareVideoTexture(texture, data) {
        const objectURL = URL.createObjectURL(new Blob([data], { type: texture.mimeType }));
        const video = document.createElement("video");
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";
        video.src = objectURL;
        try {
            await new Promise((resolve, reject) => {
                video.addEventListener("loadeddata", () => resolve(), { once: true });
                video.addEventListener("error", () => reject(new Error("Embedded scene video could not be decoded")), { once: true });
                video.load();
            });
        }
        catch (error) {
            URL.revokeObjectURL(objectURL);
            throw error;
        }
        return {
            flags: texture.flags,
            height: texture.height || video.videoHeight,
            objectURL,
            textureHeight: video.videoHeight,
            textureWidth: video.videoWidth,
            video,
            width: texture.width || video.videoWidth,
        };
    }
    async readPackage(source, sceneFile) {
        const bytes = new Uint8Array(await this.fetchPackage(source));
        const parsed = PackageReader.parse(bytes, sceneFile);
        return {
            entries: parsed.entries,
            scene: parsed.scene,
            version: parsed.version,
        };
    }
    fetchPackage(source) {
        if (globalThis.KomorebiHostBridge) {
            return globalThis.KomorebiHostBridge.read(source);
        }
        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open("GET", source, true);
            request.responseType = "arraybuffer";
            request.onload = () => {
                if (request.status === 0 || request.status === 200) {
                    resolve(request.response);
                }
                else {
                    reject(new Error(`Scene request failed: ${request.status}`));
                }
            };
            request.onerror = () => reject(new Error("Scene request failed"));
            request.send();
        });
    }
}
