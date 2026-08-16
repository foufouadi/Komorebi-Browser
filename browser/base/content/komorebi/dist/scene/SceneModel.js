import { EffectCompiler } from "../effects/EffectCompiler.js";
import { readNumber } from "../effects/AnimatedProperty.js";
import { MaterialParser, } from "../parser/MaterialParser.js";
import { TexParser } from "../parser/TexParser.js";
import { MdlParser } from "../parser/MdlParser.js";
const AUDIO_MIME_TYPES = new Map([
    ["mp3", "audio/mpeg"],
    ["ogg", "audio/ogg"],
    ["wav", "audio/wav"],
    ["m4a", "audio/mp4"],
]);
export class SceneModel {
    entries;
    scene;
    projection;
    objects;
    materialPasses;
    audioTracks;
    particles;
    constructor(pkg) {
        this.entries = pkg.entries;
        this.scene = pkg.scene;
        this.projection = this.vector(pkg.scene.general?.orthogonalprojection, [1920, 1080]);
        this.objects = new Map((pkg.scene.objects || []).map(object => [String(object.id), object]));
        this.materialPasses = new MaterialParser(this.entries);
        this.audioTracks = this.createAudioTracks();
        this.particles = this.createParticles();
    }
    createLayers() {
        const byId = new Map();
        for (const object of this.scene.objects || []) {
            const layer = this.createLayer(object);
            if (layer) {
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
                    loop: object.playbackmode === "loop",
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
            const directory = definition.material.split("/").slice(0, -1).join("/");
            const texture = this.readTexture([
                `${directory}/${textureName}.tex`,
                `materials/${textureName}.tex`,
                `${textureName}.tex`,
            ]);
            // Single/dual-channel mask textures (format 8/9) decode opaque; remap to (255,255,255,mask) so ParticleFragmentShader's alpha-driven shape survives (layers/effects still read the raw `.r`, so this stays particle-only).
            if (texture && (texture.format === 8 || texture.format === 9)) {
                const pixels = texture.pixels;
                if (pixels) {
                    for (let index = 0; index < pixels.length; index += 4) {
                        const mask = pixels[index];
                        pixels[index] = 255;
                        pixels[index + 1] = 255;
                        pixels[index + 2] = 255;
                        pixels[index + 3] = mask;
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
                origin: this.vector(object.origin, [0, 0]),
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
        if (!this.boolean(object.visible, true) || !object.image) {
            return null;
        }
        const model = this.readJSON(object.image);
        if (!model?.material) {
            return null;
        }
        const material = this.readJSON(model.material);
        const pass = material?.passes?.[0];
        const textureName = pass?.textures?.[0];
        if (!textureName) {
            return null;
        }
        const directory = model.material.split("/").slice(0, -1).join("/");
        const texture = this.readTexture([
            `${directory}/${textureName}.tex`,
            `materials/${textureName}.tex`,
            `${textureName}.tex`,
        ]);
        if (!texture) {
            return null;
        }
        const animation = EffectCompiler.compile(object.effects);
        return {
            additive: pass?.blending === "additive",
            alignment: object.alignment || "center",
            animation,
            fullscreen: model.fullscreen === true,
            model: model,
            object,
            opacity: readNumber(object.alpha, 1),
            origin: this.vector(object.origin, [0, 0]),
            rotation: this.vector(object.angles, [0, 0, 0])[2],
            scale: this.vector(object.scale, [1, 1]),
            size: this.vector(object.size ?? model.size ?? [model.width || 0, model.height || 0], [0, 0]),
            puppet: this.readPuppet(model.puppet),
            renderPasses: this.materialPasses.resolveEffects(object.effects),
            texture,
            tint: this.vector(object.color, [1, 1, 1]),
        };
    }
    resolveLayerGeometry(layer) {
        const transform = this.resolveTransform(layer.object);
        let size = [...layer.size];
        if (!size[0] || !size[1]) {
            size = [
                layer.texture.width || layer.model.width || 1,
                layer.texture.height || layer.model.height || 1,
            ];
        }
        if (layer.fullscreen) {
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
        layer.origin = transform.origin;
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
            const sine = Math.sin(resolved.angle);
            const cosine = Math.cos(resolved.angle);
            local.origin = [
                resolved.origin[0] + x * cosine - y * sine,
                resolved.origin[1] + x * sine + y * cosine,
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
        const isText = Boolean(object?.text);
        return {
            angle: isText ? 0 : this.vector(object?.angles, [0, 0, 0])[2],
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
