/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { EffectCompiler } from "../effects/EffectCompiler.js";
import { compileProperty, isAnimated, readNumber } from "../effects/AnimatedProperty.js";
import { MaterialParser, } from "../parser/MaterialParser.js";
import { TexParser } from "../parser/TexParser.js";
import { MdlParser } from "../parser/MdlParser.js";
import { collectScripts } from "../script/SceneScripts.js";
const AUDIO_MIME_TYPES = new Map([
    ["mp3", "audio/mpeg"],
    ["ogg", "audio/ogg"],
    ["wav", "audio/wav"],
    ["m4a", "audio/mp4"],
]);
// The utility layer models ship with Wallpaper Engine itself (assets/models/util), not inside the scene package.
const STOCK_MODELS = new Map([
    ["models/util/solidlayer.json", { solidlayer: true }],
    ["models/util/solidlayer_depthtest.json", { solidlayer: true }],
    ["models/util/composelayer.json", { passthrough: true }],
    ["models/util/composelayer_depthtest.json", { passthrough: true }],
    ["models/util/projectlayer.json", { passthrough: true }],
    ["models/util/fullscreenlayer.json", { passthrough: true }],
]);
export class SceneModel {
    entries;
    scene;
    projection;
    objects;
    materialPasses;
    audioTracks;
    particles;
    scripts;
    constructor(pkg) {
        this.entries = pkg.entries;
        this.scene = pkg.scene;
        this.projection = this.vector(pkg.scene.general?.orthogonalprojection, [1920, 1080]);
        this.objects = new Map((pkg.scene.objects || []).map(object => [String(object.id), object]));
        this.materialPasses = new MaterialParser(this.entries);
        this.scripts = collectScripts(pkg.scene);
        this.audioTracks = this.createAudioTracks();
        this.particles = this.createParticles();
    }
    /** Drops the package files once the layers are built; the model stays alive for the scene's scripts, which only read its JSON. */
    releasePackage() {
        this.entries = new Map();
        this.materialPasses = null;
    }
    // The colour the frame is cleared to before the first layer; null when the scene turns clearing off.
    get clearColor() {
        const general = this.scene.general ?? {};
        return this.boolean(general.clearenabled, true)
            ? this.vector(general.clearcolor, [0, 0, 0])
            : null;
    }
    // Camera parallax and shake from the scene's general settings.
    get camera() {
        const general = this.scene.general ?? {};
        const number = (value, fallback) => readNumber(value, fallback);
        return {
            parallax: this.boolean(general.cameraparallax, false)
                ? {
                    amount: number(general.cameraparallaxamount, 0.5),
                    delay: Math.max(0, number(general.cameraparallaxdelay, 0.1)),
                    influence: number(general.cameraparallaxmouseinfluence, 0.5),
                }
                : null,
            shake: this.boolean(general.camerashake, false)
                ? {
                    amplitude: number(general.camerashakeamplitude, 0.5),
                    roughness: number(general.camerashakeroughness, 1),
                    speed: number(general.camerashakespeed, 3),
                }
                : null,
        };
    }
    // Resolution of the off-screen copy of the scene that composition layers work on.
    get captureSize() {
        const scale = Math.min(1, 2560 / Math.max(this.projection[0], this.projection[1]));
        return [Math.round(this.projection[0] * scale), Math.round(this.projection[1] * scale)];
    }
    createLayers() {
        const byId = new Map();
        for (const object of this.scene.objects || []) {
            const layer = this.createLayer(object);
            if (layer && !(layer.passthrough && !layer.renderPasses.length)) {
                byId.set(String(object.id), layer);
            }
        }
        const layers = [];
        const visited = new Set();
        const append = (object) => {
            const id = String(object.id);
            if (visited.has(id)) {
                return;
            }
            visited.add(id);
            for (const dependency of object.dependencies || []) {
                const dependencyObject = this.objects.get(String(dependency));
                if (dependencyObject && String(dependency) !== id) {
                    append(dependencyObject);
                }
            }
            const layer = byId.get(id);
            if (layer) {
                layers.push(layer);
            }
        };
        for (const object of this.scene.objects || []) {
            append(object);
        }
        for (const layer of layers) {
            this.resolveLayerGeometry(layer);
        }
        return layers;
    }
    createAudioTracks() {
        const tracks = [];
        for (const object of this.scene.objects || []) {
            for (const path of object.sound || []) {
                const data = this.entries.get(path);
                if (!data) {
                    continue;
                }
                tracks.push({
                    data,
                    group: object.id ?? object.name,
                    loop: object.playbackmode === "loop",
                    random: object.playbackmode === "random",
                    mimeType: this.audioMimeType(path),
                    startSilent: object.startsilent === true,
                    title: object.name || path.split("/").pop() || path,
                    volume: readNumber(object.volume, 1),
                });
            }
        }
        return tracks;
    }
    createParticles() {
        const particles = [];
        for (const object of this.scene.objects || []) {
            if (!this.boolean(object.visible, true) || !object.particle) {
                continue;
            }
            const definition = this.readJSON(object.particle);
            if (!definition) {
                continue;
            }
            const material = this.readJSON(definition.material);
            const pass = material?.passes?.[0];
            const textureName = pass?.textures?.[0];
            if (!textureName || !definition.material) {
                continue;
            }
            // Refractive particles (rain on glass, water drops) only bend the framebuffer behind them through a normal map; drawn as plain sprites they show up as flat translucent squares.
            if (Number(pass.combos?.REFRACT)) {
                continue;
            }
            const directory = definition.material.split("/").slice(0, -1).join("/");
            const texture = this.readTexture([
                `${directory}/${textureName}.tex`,
                `materials/${textureName}.tex`,
                `${textureName}.tex`,
            ]);
            // WE's ConvertTexture0Format: an R8 texture is white with alpha = R, an RG88 one is grey = R with alpha = G (layers/effects still read the raw channels, so this stays particle-only).
            if (texture && (texture.format === 8 || texture.format === 9)) {
                const pixels = texture.pixels;
                if (pixels) {
                    const alphaOffset = texture.format === 8 ? 1 : 0;
                    for (let index = 0; index < pixels.length; index += 4) {
                        const red = pixels[index];
                        const alpha = pixels[index + alphaOffset];
                        const grey = texture.format === 8 ? red : 255;
                        pixels[index] = grey;
                        pixels[index + 1] = grey;
                        pixels[index + 2] = grey;
                        pixels[index + 3] = alpha;
                    }
                }
            }
            if (!texture) {
                continue;
            }
            const override = object.instanceoverride || {};
            const lifetime = this.range(definition.initializer, "lifetimerandom", 5);
            const size = this.range(definition.initializer, "sizerandom", 64);
            const sizeInitializer = definition.initializer?.find(initializer => initializer.name === "sizerandom");
            const velocity = this.vectorRange(definition.initializer, "velocityrandom", [0, 0]);
            const movement = definition.operator?.find(operator => operator.name === "movement");
            const angularMovement = definition.operator?.find(operator => operator.name === "angularmovement");
            const alphaFade = definition.operator?.find(operator => operator.name === "alphafade");
            const turbulence = definition.initializer?.find(initializer => initializer.name === "turbulentvelocityrandom");
            particles.push({
                alpha: this.range(definition.initializer, "alpharandom", 1),
                angularVelocity: this.vectorComponentRange(definition.initializer, "angularvelocityrandom", 2, 0),
                angularDrag: readNumber(angularMovement?.drag, 0),
                angularForce: this.vector(angularMovement?.force, [0, 0, 0]),
                animationMode: definition.animationmode,
                blending: pass.blending || "normal",
                baseCount: Math.floor((definition.maxcount ?? 100)),
                color: this.colorRange(definition.initializer),
                colorMultiplier: this.vector(override.colorn, [1, 1, 1]),
                count: (() => {
                    const adjusted = Math.floor((definition.maxcount ?? 100) * readNumber(override.count, 1));
                    return adjusted > 0 ? adjusted : 1000;
                })(),
                emitters: (definition.emitter || []).map(emitter => ({
                    delay: readNumber(emitter.delay, 0),
                    directions: this.vector(emitter.directions, [1, 1, 0]),
                    duration: readNumber(emitter.duration, 0),
                    flags: readNumber(emitter.flags, 0),
                    instantaneous: readNumber(emitter.instantaneous, 0),
                    max: this.vector(emitter.distancemax, [256, 256, 0]),
                    maxPeriodicDelay: readNumber(emitter.maxperiodicdelay, 2),
                    maxPeriodicDuration: readNumber(emitter.maxperiodicduration, 3),
                    min: this.vector(emitter.distancemin, [0, 0, 0]),
                    minPeriodicDelay: readNumber(emitter.minperiodicdelay, 1),
                    minPeriodicDuration: readNumber(emitter.minperiodicduration, 2),
                    origin: this.vector(emitter.origin, [0, 0, 0]),
                    baseRate: readNumber(emitter.rate, 10),
                    rate: readNumber(emitter.rate, 10) * readNumber(override.rate, 1),
                    sign: this.vector(emitter.sign, [0, 0, 0]),
                    speed: [
                        readNumber(emitter.speedmin, 0),
                        readNumber(emitter.speedmax, 0),
                    ],
                    type: emitter.name,
                })),
                fadeIn: alphaFade ? readNumber(alphaFade.fadeintime, 0.5) : 0,
                fadeOut: alphaFade ? readNumber(alphaFade.fadeouttime, 0.5) : 1,
                gravity: this.vector(movement?.gravity, [0, 0]),
                lifetime: this.overrideRange(lifetime, override.lifetime),
                opacity: readNumber(override.alpha, 1),
                origin: this.vector(object.origin, [0, 0]).map((value, axis) => axis === 1 ? this.projection[1] - value : value),
                objectId: object.id,
                projection: this.projection,
                rotation: this.vectorComponentRange(definition.initializer, "rotationrandom", 2, 0),
                scale: this.vector(object.scale, [1, 1]),
                sequenceMultiplier: readNumber(definition.sequencemultiplier, 1),
                // Negated to match the engine's Y-flipped coordinate system, same as layer rotation.
                systemAngle: -this.vector(object.angles, [0, 0, 0])[2],
                size,
                sizeExponent: readNumber(sizeInitializer?.exponent, 1),
                sizeScale: readNumber(override.size, 1),
                speed: readNumber(override.speed, 1),
                texture,
                movementDrag: readNumber(movement?.drag, 0),
                turbulence: turbulence
                    ? {
                        offset: readNumber(turbulence.offset, 0),
                        scale: readNumber(turbulence.scale, 0),
                        speed: [
                            readNumber(turbulence.speedmin, 0),
                            readNumber(turbulence.speedmax, 0),
                        ],
                    }
                    : null,
                velocity,
            });
        }
        return particles;
    }
    range(initializers, name, fallback) {
        let initializer;
        for (let index = (initializers?.length ?? 0) - 1; index >= 0; index--) {
            const candidate = initializers[index];
            if (candidate.name === name &&
                (candidate.min !== undefined || candidate.max !== undefined)) {
                initializer = candidate;
                break;
            }
        }
        return [
            readNumber(initializer?.min, fallback),
            readNumber(initializer?.max, fallback),
        ];
    }
    vectorComponentRange(initializers, name, component, fallback) {
        const range = this.vectorRange(initializers, name, [
            fallback,
            fallback,
            fallback,
        ]);
        return [range.min[component], range.max[component]];
    }
    overrideRange(range, value) {
        const multiplier = readNumber(value, 1);
        return range.map(number => number * multiplier);
    }
    vectorRange(initializers, name, fallback) {
        let initializer;
        for (let index = (initializers?.length ?? 0) - 1; index >= 0; index--) {
            const candidate = initializers[index];
            if (candidate.name === name &&
                (candidate.min !== undefined || candidate.max !== undefined)) {
                initializer = candidate;
                break;
            }
        }
        return {
            max: this.vector(initializer?.max, fallback),
            min: this.vector(initializer?.min, fallback),
        };
    }
    colorRange(initializers) {
        const range = this.vectorRange(initializers, "colorrandom", [255, 255, 255]);
        return {
            max: range.max.map(value => value / 255),
            min: range.min.map(value => value / 255),
        };
    }
    audioMimeType(path) {
        const extension = path.split(".").pop()?.toLowerCase() || "";
        return AUDIO_MIME_TYPES.get(extension) || "application/octet-stream";
    }
    createLayer(object) {
        const visible = this.boolean(object.visible, true);
        const text = object.image ? null : this.readText(object);
        // A script can show an object that starts hidden, so such scenes keep it around, undrawn.
        if ((!visible && !this.scripts.length) || (!object.image && !text)) {
            return null;
        }
        const model = text ? {} : (this.readJSON(object.image) ?? STOCK_MODELS.get(object.image));
        if (!model) {
            return null;
        }
        const passthrough = model.passthrough === true;
        const solid = model.solidlayer === true || passthrough;
        // A composition layer re-draws what the layers below it produced, so it only matters when it has effects. One that covers just a part of the scene would need a cropped capture, which is not done.
        if (passthrough && (!visible || !this.coversScene(object))) {
            return null;
        }
        let texture;
        let pass;
        if (solid || text) {
            // A flat colour: one white texel stretched over the layer, tinted by the object's colour. A text layer starts as one too; the loader replaces it with the rendered text.
            pass = { blending: "translucent" };
            texture = {
                flags: 2,
                format: 0,
                height: 1,
                pixels: new Uint8ClampedArray([255, 255, 255, 255]),
                textureHeight: 1,
                textureWidth: 1,
                type: "pixels",
                width: 1,
            };
        }
        else {
            if (!model.material) {
                return null;
            }
            const material = this.readJSON(model.material);
            pass = material?.passes?.[0];
            const textureName = pass?.textures?.[0];
            if (!textureName) {
                return null;
            }
            const directory = model.material.split("/").slice(0, -1).join("/");
            texture = this.readTexture([
                `${directory}/${textureName}.tex`,
                `materials/${textureName}.tex`,
                `${textureName}.tex`,
            ]);
            if (!texture) {
                return null;
            }
        }
        const animation = EffectCompiler.compile(object.effects);
        // Intro fades and similar: the alpha keyframes play from the start of the scene.
        const alpha = compileProperty(object.alpha, 1);
        return {
            opacityAnimation: isAnimated(alpha) ? alpha : null,
            additive: pass?.blending === "additive",
            blendMode: Math.max(0, Math.floor(readNumber(object.colorBlendMode, 0))),
            hidden: !visible,
            parallaxDepth: this.vector(object.parallaxDepth, [0, 0]),
            alignment: object.alignment || "center",
            animation,
            fullscreen: model.fullscreen === true,
            model: model,
            object,
            animationLayers: Array.isArray(object.animationlayers) ? object.animationlayers : [],
            opacity: readNumber(object.alpha, 1),
            origin: this.vector(object.origin, [0, 0]),
            rotation: this.vector(object.angles, [0, 0, 0])[2],
            scale: this.vector(object.scale, [1, 1]),
            size: this.vector(object.size ?? model.size ?? [model.width || 0, model.height || 0], [0, 0]),
            solid,
            passthrough,
            puppet: this.readPuppet(model.puppet),
            renderPasses: this.materialPasses.resolveEffects(object.effects),
            text,
            texture,
            tint: text?.background ? [1, 1, 1] : this.vector(object.color, [1, 1, 1]),
        };
    }
    textString(object) {
        const text = object.text;
        const value = typeof text === "object" && text !== null ? text.value : text;
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
    }
    // The state of a text layer: what to draw and how to lay it out. The loader and the renderer rasterize it into the layer's texture.
    readText(object) {
        if (object.text === undefined || object.text === null) {
            return null;
        }
        const size = this.vector(object.size, [0, 0]);
        if (!(size[0] > 0 && size[1] > 0)) {
            return null;
        }
        const string = (value, fallback) => {
            const source = value !== null && typeof value === "object" && "value" in value ? value.value : value;
            return typeof source === "string" ? source.toLowerCase() : fallback;
        };
        const source = this.textString(object);
        const scripted = typeof object.text?.script === "string";
        const color = this.vector(object.color, [1, 1, 1]);
        return {
            box: size,
            density: [1, 1],
            margin: [0, 0],
            resized: false,
            background: this.boolean(object.opaquebackground, false)
                ? this.vector(object.backgroundcolor, [0, 0, 0])
                : null,
            color,
            dirty: true,
            ellipsis: this.boolean(object.limituseellipsis, false),
            face: null,
            family: "",
            font: typeof object.font === "string" ? object.font : "",
            horizontal: string(object.horizontalalign, "center"),
            maxRows: this.boolean(object.limitrows, false) ? Math.max(1, Math.floor(readNumber(object.maxrows, 1))) : 0,
            maxWidth: this.boolean(object.limitwidth, false) ? Math.max(0, readNumber(object.maxwidth, 0)) : 0,
            padding: this.vector(object.padding, [0, 0]),
            pixelHeight: 1,
            pixelWidth: 1,
            pointSize: Math.max(1, readNumber(object.pointsize, 32)),
            source,
            unit: [1, 1],
            // A script decides the string; until it answers there is nothing to show.
            value: scripted ? "" : source,
            vertical: string(object.verticalalign, "center"),
        };
    }
    coversScene(object) {
        if (!this.boolean(object.visible, true)) {
            return false;
        }
        const size = this.vector(object.size, [0, 0]);
        return !size[0] || !size[1] || (size[0] >= this.projection[0] * 0.95 && size[1] >= this.projection[1] * 0.95);
    }
    resolveLayerGeometry(layer) {
        const transform = this.resolveTransform(layer.object);
        let size = [...layer.size];
        if ((!size[0] || !size[1]) && layer.solid) {
            // A flat layer with no size covers the scene; one explicitly sized zero covers nothing.
            size = layer.object.size === undefined ? [...this.projection] : [0, 0];
        }
        else if (!size[0] || !size[1]) {
            size = [
                layer.texture.width || layer.model.width || 1,
                layer.texture.height || layer.model.height || 1,
            ];
        }
        if (layer.fullscreen || layer.passthrough) {
            size = [...this.projection];
            transform.origin = [this.projection[0] / 2, this.projection[1] / 2, 0];
        }
        const scaledWidth = size[0] * transform.scale[0];
        const scaledHeight = size[1] * transform.scale[1];
        const alignment = layer.alignment.toLowerCase();
        if (alignment.includes("top")) {
            transform.origin[1] -= scaledHeight / 2;
        }
        else if (alignment.includes("bottom")) {
            transform.origin[1] += scaledHeight / 2;
        }
        if (alignment.includes("left")) {
            transform.origin[0] += scaledWidth / 2;
        }
        else if (alignment.includes("right")) {
            transform.origin[0] -= scaledWidth / 2;
        }
        // Scene space is Y-up (origin at the bottom-left); the renderer works from the top-left.
        layer.origin = [transform.origin[0], this.projection[1] - transform.origin[1], transform.origin[2]];
        layer.rotation = transform.angle;
        layer.scale = transform.scale;
        layer.size = size;
    }
    resolveTransform(object) {
        const chain = [];
        const seen = new Set();
        let current = object;
        while (current && chain.length <= 32 && !seen.has(String(current.id))) {
            chain.push(current);
            seen.add(String(current.id));
            current =
                current.parent === undefined || current.parent === null
                    ? null
                    : this.objects.get(String(current.parent));
        }
        let resolved = this.localTransform(chain.at(-1));
        for (let index = chain.length - 2; index >= 0; index--) {
            const local = this.localTransform(chain[index]);
            const x = local.origin[0] * resolved.scale[0];
            const y = local.origin[1] * resolved.scale[1];
            // Angles are clockwise-positive, and the offsets are still Y-up here.
            const sine = Math.sin(resolved.angle);
            const cosine = Math.cos(resolved.angle);
            local.origin = [
                resolved.origin[0] + x * cosine + y * sine,
                resolved.origin[1] - x * sine + y * cosine,
                resolved.origin[2] + local.origin[2] * resolved.scale[2],
            ];
            resolved = {
                angle: local.angle + resolved.angle,
                origin: local.origin,
                scale: local.scale.map((value, axis) => value * resolved.scale[axis]),
            };
        }
        return resolved;
    }
    localTransform(object) {
        // Wallpaper Engine angles turn counter-clockwise on screen; the renderer's run clockwise.
        return {
            angle: -this.vector(object?.angles, [0, 0, 0])[2],
            origin: this.vector(object?.origin, [0, 0, 0]),
            scale: this.vector(object?.scale, [1, 1, 1]),
        };
    }
    readTexture(paths) {
        for (const path of paths) {
            const content = this.entries.get(path);
            if (!content) {
                continue;
            }
            try {
                return new TexParser(content).parse();
            }
            catch (error) {
                console.error(`Komorebi could not decode ${path}`, error);
            }
        }
        return null;
    }
    readJSON(path) {
        const content = path === undefined ? undefined : this.entries.get(path);
        if (!content) {
            return null;
        }
        try {
            return JSON.parse(new TextDecoder().decode(content));
        }
        catch (error) {
            console.error(`Komorebi could not parse ${path}`, error);
            return null;
        }
    }
    readPuppet(path) {
        if (!path) {
            return null;
        }
        const content = this.entries.get(path);
        if (!content) {
            return null;
        }
        try {
            return MdlParser.parse(content);
        }
        catch (error) {
            console.error(`Komorebi could not decode ${path}`, error);
            return null;
        }
    }
    vector(value, fallback) {
        const source = value !== null && typeof value === "object" && "value" in value
            ? (value.value ?? value)
            : value;
        let values = [];
        if (Array.isArray(source)) {
            values = source;
        }
        else if (typeof source === "string") {
            values = source.trim().split(/\s+/);
        }
        else if (typeof source === "number") {
            values = fallback.map(() => source);
        }
        else if (source && typeof source === "object") {
            const record = source;
            values = [
                record.x ?? record.width,
                record.y ?? record.height,
                record.z ?? record.depth,
            ];
        }
        return fallback.map((defaultValue, index) => readNumber(values[index], defaultValue));
    }
    boolean(value, fallback) {
        const source = value !== null && typeof value === "object" && "value" in value
            ? (value.value ?? value)
            : value;
        return typeof source === "boolean" ? source : fallback;
    }
}
