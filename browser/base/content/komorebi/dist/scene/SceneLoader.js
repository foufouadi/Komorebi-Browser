import { PackageReader } from "../io/PackageReader.js";
import { createStaticBuffer } from "../graphics/BufferUtils.js";
import { collectIncludeNames } from "../parser/ShaderIncludes.js";
import { SceneModel } from "./SceneModel.js";
import { TexParser } from "../parser/TexParser.js";
function numberLines(source) {
    // GLSL "line:column" errors are 1-indexed, matching this.
    return source
        .split("\n")
        .map((line, index) => `${index + 1}: ${line}`)
        .join("\n");
}
export class SceneLoader {
    #graphics;
    #entries = new Map();
    constructor(graphics) {
        this.#graphics = graphics;
    }
    async load(packageSource, sceneFile, assetRoot, isCancelled) {
        const pkg = await this.readPackage(packageSource, sceneFile);
        await this.loadExternalTextures(pkg, assetRoot);
        // Must complete before SceneModel/MaterialParser compile any shader (ShaderParser.compile is synchronous).
        await this.loadExternalShaders(pkg, assetRoot);
        this.#entries = pkg.entries;
        if (isCancelled()) {
            return null;
        }
        const sceneModel = new SceneModel(pkg);
        const layers = sceneModel.createLayers();
        if (!layers.length) {
            throw new Error(`Scene texture format is not supported (${packageSource})`);
        }
        if (isCancelled()) {
            return null;
        }
        const preparedLayers = await this.prepareLayers(layers, isCancelled);
        if (!preparedLayers) {
            return null;
        }
        const preparedParticles = await this.prepareParticles(sceneModel.particles);
        return { sceneModel, layers: preparedLayers, particles: preparedParticles };
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
    async prepareLayers(layers, isCancelled) {
        const preparedLayers = [];
        for (const layer of layers) {
            const asset = await this.prepareTexture(layer.texture);
            const preparedLayer = {
                ...layer,
                ...this.#graphics.textures.upload(asset),
            };
            this.preparePuppet(preparedLayer);
            await this.prepareMaterialPasses(preparedLayer);
            asset.bitmap?.close();
            if (isCancelled()) {
                return null;
            }
            preparedLayers.push(preparedLayer);
        }
        return preparedLayers;
    }
    async prepareParticles(particles) {
        const prepared = [];
        for (const particle of particles) {
            const asset = await this.prepareTexture(particle.texture);
            prepared.push({
                ...particle,
                ...this.#graphics.textures.upload(asset),
            });
            asset.bitmap?.close();
        }
        return prepared;
    }
    preparePuppet(layer) {
        if (!layer.puppet) {
            return;
        }
        const gl = this.#graphics.gl;
        const width = layer.size[0] || 1;
        const height = layer.size[1] || 1;
        const positions = new Float32Array(layer.puppet.positions.length);
        const effectPositions = new Float32Array(layer.puppet.positions.length * 1.5);
        // layer.puppet.positions[y] already carries MdlParser's Y-down flip; do not re-negate here or the mesh renders upside down.
        for (let index = 0; index < positions.length; index += 2) {
            positions[index] = layer.puppet.positions[index] / width;
            positions[index + 1] = layer.puppet.positions[index + 1] / height;
            const effectIndex = (index / 2) * 3;
            effectPositions[effectIndex] = width / 2 + layer.puppet.positions[index];
            effectPositions[effectIndex + 1] =
                height / 2 + layer.puppet.positions[index + 1];
            effectPositions[effectIndex + 2] = 0;
        }
        layer.puppetPositionBuffer = createStaticBuffer(gl, positions);
        layer.puppetEffectPositionBuffer = createStaticBuffer(gl, effectPositions);
        layer.puppetTexCoordBuffer = createStaticBuffer(gl, layer.puppet.texCoords);
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
                        const asset = await this.prepareTexture(parsed);
                        texture = this.#graphics.textures.upload(asset);
                        asset.bitmap?.close();
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
    async prepareTexture(texture) {
        if (texture.type === "video") {
            return this.prepareVideoTexture(texture);
        }
        if (texture.type !== "image") {
            return texture;
        }
        const bitmap = await createImageBitmap(new Blob([texture.data], { type: texture.mimeType }));
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
    async prepareVideoTexture(texture) {
        const objectURL = URL.createObjectURL(new Blob([texture.data], { type: texture.mimeType }));
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
