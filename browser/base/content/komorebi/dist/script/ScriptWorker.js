/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// The SceneScript engine. workerMain() is not imported anywhere: ScriptSandbox
// serialises it with toString() and runs the text inside a dedicated worker,
// so it must not refer to anything outside its own body.
export function workerMain() {
    "use strict";
    const MAX_CHANGES = 4096;
    const MAX_ERRORS = 32;
    const MAX_STRING = 256;
    const MAX_TYPED_ARRAY = 1 << 22;
    const MAX_STRING_LENGTH = 1 << 22;
    const CURSOR_EVENTS = new Set([
        "cursorClick",
        "cursorDown",
        "cursorUp",
        "cursorEnter",
        "cursorLeave",
        "cursorMove",
    ]);
    const HANDLERS = [
        "init",
        "update",
        "applyUserProperties",
        "destroy",
        "mediaPlaybackChanged",
        "mediaPropertiesChanged",
        "mediaThumbnailChanged",
        "mediaTimelineChanged",
        "animationEvent",
        ...CURSOR_EVENTS,
    ];
    const LAYER_PROPERTIES = new Set([
        "visible",
        "alpha",
        "color",
        "origin",
        "scale",
        "angles",
        "parallaxDepth",
        "text",
    ]);
    const BLOCKED = [
        "fetch", "XMLHttpRequest", "XMLHttpRequestUpload", "WebSocket", "EventSource", "importScripts",
        "Worker", "SharedWorker", "BroadcastChannel", "MessageChannel", "MessagePort", "MessageEvent",
        "postMessage", "close", "indexedDB", "IDBFactory", "caches", "CacheStorage", "WebTransport",
        "RTCPeerConnection", "WebAssembly", "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "setImmediate", "navigator", "location", "Notification", "FileReader", "FileReaderSync",
        "Request", "Response", "Headers", "FormData", "crypto", "Crypto", "SubtleCrypto", "SharedArrayBuffer",
        "Atomics", "OffscreenCanvas", "createImageBitmap", "addEventListener", "removeEventListener",
        "dispatchEvent", "onmessage", "onmessageerror", "onerror", "serviceWorker", "reportError",
        "structuredClone", "performance", "Performance", "console",
    ];

    const nativeFunction = Function;
    const nativeDate = Date;
    const nativeMath = Math;
    const hasOwn = Object.prototype.hasOwnProperty;
    let port = null;

    // ----------------------------------------------------------------
    // Lock-down: runs before any scene script is compiled. The sandbox CSP
    // already refuses every network request; this removes the means too.
    // ----------------------------------------------------------------
    function lockDown() {
        for (let target = self; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
            for (const name of BLOCKED) {
                if (!hasOwn.call(target, name)) {
                    continue;
                }
                try {
                    delete target[name];
                } catch {}
                if (hasOwn.call(target, name)) {
                    try {
                        Object.defineProperty(target, name, { value: undefined });
                    } catch {}
                }
            }
        }
        try {
            delete URL.createObjectURL;
        } catch {}
        // Bounded allocations: scene scripts have no reason to build huge buffers.
        const guard = (owner, name, limit, sizeOf) => {
            const Original = owner[name];
            if (typeof Original !== "function") {
                return;
            }
            const Guarded = new Proxy(Original, {
                construct(target, args, newTarget) {
                    if (sizeOf(args) > limit) {
                        throw new RangeError("allocation too large");
                    }
                    return Reflect.construct(target, args, newTarget === Guarded ? target : newTarget);
                },
            });
            try {
                Original.prototype.constructor = Guarded;
            } catch {}
            owner[name] = Guarded;
        };
        const firstNumber = args => (typeof args[0] === "number" ? args[0] : 0);
        guard(self, "ArrayBuffer", MAX_TYPED_ARRAY * 8, firstNumber);
        for (const name of [
            "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
            "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
        ]) {
            guard(self, name, MAX_TYPED_ARRAY, firstNumber);
        }
        const repeat = String.prototype.repeat;
        String.prototype.repeat = function (count) {
            if (this.length * count > MAX_STRING_LENGTH) {
                throw new RangeError("string too large");
            }
            return repeat.call(this, count);
        };
        for (const name of ["padStart", "padEnd"]) {
            const original = String.prototype[name];
            String.prototype[name] = function (length, fill) {
                if (length > MAX_STRING_LENGTH) {
                    throw new RangeError("string too large");
                }
                return original.call(this, length, fill);
            };
        }
    }

    // ----------------------------------------------------------------
    // Vec2 / Vec3 / Vec4 and the WE helper modules.
    // ----------------------------------------------------------------
    function defineVector(size) {
        const keys = ["x", "y", "z", "w"].slice(0, size);
        class Vector {
            constructor(...args) {
                const first = args[0];
                if (typeof first === "string") {
                    const parts = first.trim().split(/\s+/);
                    keys.forEach((key, index) => {
                        this[key] = Number.parseFloat(parts[index]) || 0;
                    });
                } else if (first !== null && typeof first === "object") {
                    keys.forEach(key => {
                        this[key] = typeof first[key] === "number" ? first[key] : 0;
                    });
                } else if (typeof first === "number") {
                    keys.forEach((key, index) => {
                        this[key] = typeof args[index] === "number" ? args[index] : args.length === 1 ? first : 0;
                    });
                } else {
                    keys.forEach(key => {
                        this[key] = 0;
                    });
                }
            }
            static #make(values) {
                return new Vector(...values);
            }
            #map(other, operation) {
                return Vector.#make(
                    keys.map((key, index) => operation(this[key], typeof other === "number" ? other : (other?.[key] ?? 0), index))
                );
            }
            copy() {
                return Vector.#make(keys.map(key => this[key]));
            }
            add(other) {
                return this.#map(other, (a, b) => a + b);
            }
            subtract(other) {
                return this.#map(other, (a, b) => a - b);
            }
            multiply(other) {
                return this.#map(other, (a, b) => a * b);
            }
            divide(other) {
                return this.#map(other, (a, b) => a / b);
            }
            min(other) {
                return this.#map(other, (a, b) => nativeMath.min(a, b));
            }
            max(other) {
                return this.#map(other, (a, b) => nativeMath.max(a, b));
            }
            mix(other, amount) {
                return Vector.#make(
                    keys.map(key => this[key] + (other[key] - this[key]) * (typeof amount === "number" ? amount : amount[key]))
                );
            }
            clamp(low, high) {
                return this.max(low).min(high);
            }
            negate() {
                return Vector.#make(keys.map(key => -this[key]));
            }
            abs() {
                return Vector.#make(keys.map(key => nativeMath.abs(this[key])));
            }
            sign() {
                return Vector.#make(keys.map(key => nativeMath.sign(this[key])));
            }
            round() {
                return Vector.#make(keys.map(key => nativeMath.round(this[key])));
            }
            floor() {
                return Vector.#make(keys.map(key => nativeMath.floor(this[key])));
            }
            ceil() {
                return Vector.#make(keys.map(key => nativeMath.ceil(this[key])));
            }
            fract() {
                return Vector.#make(keys.map(key => this[key] - nativeMath.floor(this[key])));
            }
            dot(other) {
                return keys.reduce((sum, key) => sum + this[key] * other[key], 0);
            }
            lengthSqr() {
                return this.dot(this);
            }
            length() {
                return nativeMath.sqrt(this.lengthSqr());
            }
            distance(other) {
                return this.subtract(other).length();
            }
            distanceSqr(other) {
                return this.subtract(other).lengthSqr();
            }
            normalize() {
                return this.divide(this.length());
            }
            equals(other) {
                return other instanceof Vector && keys.every(key => nativeMath.abs(this[key] - other[key]) < 1e-5);
            }
            isFinite() {
                return keys.every(key => Number.isFinite(this[key]));
            }
            toString() {
                return keys.map(key => this[key]).join(" ");
            }
            toConfigString() {
                return this.toString();
            }
        }
        if (size === 3) {
            Vector.prototype.cross = function (other) {
                return new Vector(
                    this.y * other.z - this.z * other.y,
                    this.z * other.x - this.x * other.z,
                    this.x * other.y - this.y * other.x
                );
            };
        }
        return Vector;
    }
    const Vec2 = defineVector(2);
    const Vec3 = defineVector(3);
    const Vec4 = defineVector(4);
    const WEMath = {
        deg2rad: nativeMath.PI / 180,
        rad2deg: 180 / nativeMath.PI,
        mix: (a, b, amount) => a + (b - a) * amount,
        smoothStep(low, high, value) {
            const x = nativeMath.max(0, nativeMath.min(1, (value - low) / (high - low)));
            return x * x * (3 - 2 * x);
        },
    };
    const WEVector = {
        angleVector2(angle) {
            const radians = angle * WEMath.deg2rad;
            return new Vec2(nativeMath.cos(radians), nativeMath.sin(radians));
        },
        vectorAngle2: direction => nativeMath.atan2(direction.y, direction.x) * WEMath.rad2deg,
    };
    const WEColor = {
        rgb2hsv(color) {
            const { x: r, y: g, z: b } = color;
            const max = nativeMath.max(r, g, b);
            const min = nativeMath.min(r, g, b);
            const delta = max - min;
            let hue = 0;
            if (delta !== 0) {
                if (max === r) {
                    hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
                } else if (max === g) {
                    hue = ((b - r) / delta + 2) / 6;
                } else {
                    hue = ((r - g) / delta + 4) / 6;
                }
            }
            return new Vec3(hue, max === 0 ? 0 : delta / max, max);
        },
        hsv2rgb(color) {
            const { x: hue, y: saturation, z: value } = color;
            const sector = nativeMath.floor(hue * 6);
            const fraction = hue * 6 - sector;
            const p = value * (1 - saturation);
            const q = value * (1 - fraction * saturation);
            const t = value * (1 - (1 - fraction) * saturation);
            const table = [
                [value, t, p],
                [q, value, p],
                [p, value, t],
                [p, q, value],
                [t, p, value],
                [value, p, q],
            ];
            return new Vec3(...table[((sector % 6) + 6) % 6]);
        },
        normalizeColor: color => new Vec3(color.x / 255, color.y / 255, color.z / 255),
        expandColor: color => new Vec3(color.x * 255, color.y * 255, color.z * 255),
    };
    const MODULES = { WEMath, WEColor, WEVector };

    // ----------------------------------------------------------------
    // Scene mirror: every object of scene.json, with the properties scripts
    // can read and write.
    // ----------------------------------------------------------------
    const scene = {
        objects: new Map(),
        byName: new Map(),
        order: [],
        projection: [1920, 1080],
    };
    const watched = new Set();
    const user = {};
    const shared = {};
    const storage = new Map();
    const input = { screen: [0, 0], world: [0, 0], leftDown: false };
    const clock = { runtime: 0, frametime: 1 / 60, timers: [], nextTimer: 1 };
    const state = { current: null, errors: [], changes: [], dropped: 0 };
    const scripts = [];
    const interactive = new Set();

    const vec3Of = values => new Vec3(values[0], values[1], values[2]);

    class TextureAnimation {
        constructor(layer) {
            this.layer = layer;
            this.rate = 1;
            this.frame = 0;
            this.frameCount = 0;
        }
        getFrame() {
            return this.frame;
        }
        setFrame(frame) {
            const index = nativeMath.max(0, nativeMath.floor(Number(frame) || 0));
            this.frame = index;
            this.layer.dirtyFrame = index;
            watched.add(this.layer);
        }
        play() {
            this.rate = 1;
        }
        pause() {
            this.rate = 0;
        }
        stop() {
            this.rate = 0;
            this.setFrame(0);
        }
    }

    // Stand-in for puppet animations and effect handles, which this renderer does not run.
    class InertHandle {
        constructor(name) {
            this.name = name;
            this.rate = 1;
            this.frame = 0;
            this.duration = 0;
        }
        play() {}
        pause() {}
        stop() {}
        setFrame() {}
        getFrame() {
            return 0;
        }
        isPlaying() {
            return false;
        }
        setDirection() {}
        setDuration() {}
        setEndSignal() {}
    }

    class LayerHandle {
        constructor(data) {
            this.id = data.id;
            this.name = data.name;
            this.parentId = data.parent;
            this.kind = data.kind;
            this.size = new Vec2(data.size[0], data.size[1]);
            this.dirtyFrame = -1;
            this.textureAnimation = null;
            this.values = {
                text: typeof data.text === "string" ? data.text : "",
                visible: data.visible,
                alpha: data.alpha,
                origin: vec3Of(data.origin),
                scale: vec3Of(data.scale),
                angles: vec3Of(data.angles),
                color: vec3Of(data.color),
                parallaxDepth: new Vec2(data.parallaxDepth[0], data.parallaxDepth[1]),
            };
            this.sent = this.snapshot();
            // The page shows nothing for a scripted text until the first value arrives, so that value is always sent.
            this.sentText = this.kind === "text" ? null : this.values.text;
        }
        snapshot() {
            const { values } = this;
            return [
                values.visible ? 1 : 0,
                values.alpha,
                values.origin.x, values.origin.y, values.origin.z,
                values.scale.x, values.scale.y, values.scale.z,
                values.angles.x, values.angles.y, values.angles.z,
                values.color.x, values.color.y, values.color.z,
                values.parallaxDepth.x, values.parallaxDepth.y,
            ];
        }
        #setVector(name, value) {
            const target = this.values[name];
            const source = typeof value === "number" ? new target.constructor(value) : value;
            if (source === null || typeof source !== "object") {
                return;
            }
            for (const key of ["x", "y", "z"]) {
                if (key in target && typeof source[key] === "number") {
                    target[key] = source[key];
                }
            }
            watched.add(this);
        }
        #getVector(name) {
            watched.add(this);
            return this.values[name];
        }
        get text() {
            return this.values.text;
        }
        set text(value) {
            this.values.text = String(value ?? "");
            watched.add(this);
        }
        get visible() {
            return this.values.visible;
        }
        set visible(value) {
            this.values.visible = Boolean(value);
            watched.add(this);
        }
        get alpha() {
            return this.values.alpha;
        }
        set alpha(value) {
            const number = Number(value);
            if (Number.isFinite(number)) {
                this.values.alpha = number;
                watched.add(this);
            }
        }
        get origin() {
            return this.#getVector("origin");
        }
        set origin(value) {
            this.#setVector("origin", value);
        }
        get scale() {
            return this.#getVector("scale");
        }
        set scale(value) {
            this.#setVector("scale", value);
        }
        get angles() {
            return this.#getVector("angles");
        }
        set angles(value) {
            this.#setVector("angles", value);
        }
        get color() {
            return this.#getVector("color");
        }
        set color(value) {
            this.#setVector("color", value);
        }
        get parallaxDepth() {
            return this.#getVector("parallaxDepth");
        }
        set parallaxDepth(value) {
            this.#setVector("parallaxDepth", value);
        }
        getParent() {
            return this.parentId === null ? null : (scene.objects.get(this.parentId) ?? null);
        }
        getTextureAnimation() {
            this.textureAnimation ??= new TextureAnimation(this);
            return this.textureAnimation;
        }
        getAnimation(name) {
            return new InertHandle(name);
        }
        getAnimationLayer(name) {
            return new InertHandle(name);
        }
        getAnimationLayerCount() {
            return 0;
        }
        getEffect(name) {
            return new InertHandle(name);
        }
        getBoneIndex() {
            return -1;
        }
        getTransformMatrix() {
            const { origin, scale, angles } = this.values;
            const cosine = nativeMath.cos(angles.z);
            const sine = nativeMath.sin(angles.z);
            return {
                m: [
                    scale.x * cosine, scale.x * sine, 0, 0,
                    -scale.y * sine, scale.y * cosine, 0, 0,
                    0, 0, scale.z, 0,
                    origin.x, origin.y, origin.z, 1,
                ],
            };
        }
        play() {}
        pause() {}
        stop() {}
        isPlaying() {
            return false;
        }
        setVolume() {}
    }

    const thisScene = {
        getLayer(key) {
            if (typeof key === "number") {
                return scene.order[key] ?? scene.objects.get(key) ?? null;
            }
            return scene.byName.get(String(key)) ?? null;
        },
        getLayerIndex(layer) {
            return scene.order.indexOf(layer);
        },
        enumerateLayers() {
            return scene.order.slice();
        },
        sortLayer() {},
        createLayer() {
            return null;
        },
        destroyLayer() {},
        getInitialLayerConfig() {
            return null;
        },
        getCameraTransforms() {
            return { eye: new Vec3(0, 0, 0), center: new Vec3(0, 0, -1), up: new Vec3(0, 1, 0) };
        },
        setCameraTransforms() {},
    };

    const engine = {
        AUDIO_RESOLUTION_16: 16,
        AUDIO_RESOLUTION_32: 32,
        AUDIO_RESOLUTION_64: 64,
        get runtime() {
            return clock.runtime;
        },
        get frametime() {
            return clock.frametime;
        },
        get timeOfDay() {
            const now = new nativeDate();
            return (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400;
        },
        get userProperties() {
            return user;
        },
        get canvasSize() {
            return new Vec2(scene.projection[0], scene.projection[1]);
        },
        get screenResolution() {
            return new Vec2(scene.projection[0], scene.projection[1]);
        },
        isDesktopDevice: () => true,
        isMobileDevice: () => false,
        isWallpaper: () => true,
        isScreensaver: () => false,
        isRunningInEditor: () => false,
        isPortrait: () => scene.projection[1] > scene.projection[0],
        isLandscape: () => scene.projection[1] <= scene.projection[0],
        openUserShortcut() {},
        registerAudioBuffers(resolution) {
            const length = nativeMath.max(1, nativeMath.min(64, nativeMath.floor(Number(resolution)) || 16));
            return {
                resolution: length,
                average: new Float32Array(length),
                left: new Float32Array(length),
                right: new Float32Array(length),
            };
        },
        setTimeout(callback, milliseconds) {
            return addTimer(callback, milliseconds, false);
        },
        setInterval(callback, milliseconds) {
            return addTimer(callback, milliseconds, true);
        },
        clearTimeout: removeTimer,
        clearInterval: removeTimer,
    };

    function addTimer(callback, milliseconds, repeat) {
        if (typeof callback !== "function" || clock.timers.length > 256) {
            return 0;
        }
        const delay = nativeMath.max(0, Number(milliseconds) || 0) / 1000;
        const id = clock.nextTimer++;
        clock.timers.push({ at: clock.runtime + delay, callback, delay, id, repeat, script: state.current });
        return id;
    }

    function removeTimer(id) {
        clock.timers = clock.timers.filter(timer => timer.id !== id);
    }

    const cursorInput = {
        get cursorWorldPosition() {
            return new Vec3(input.world[0], input.world[1], 0);
        },
        get cursorScreenPosition() {
            return new Vec2(input.screen[0], input.screen[1]);
        },
        get cursorLeftDown() {
            return input.leftDown;
        },
    };

    const localStorageApi = {
        LOCATION_SCENE: "scene",
        LOCATION_GLOBAL: "global",
        LOCATION: "scene",
        get(key, location) {
            return storage.get(`${location ?? "scene"}:${key}`);
        },
        set(key, value, location) {
            if (storage.size < 1024) {
                storage.set(`${location ?? "scene"}:${key}`, typeof value === "string" ? value.slice(0, 4096) : value);
            }
        },
        delete(key, location) {
            storage.delete(`${location ?? "scene"}:${key}`);
        },
        clear() {
            storage.clear();
        },
    };

    const MediaPlaybackEvent = class {
        static PLAYBACK_STOPPED = 0;
        static PLAYBACK_PLAYING = 1;
        static PLAYBACK_PAUSED = 2;
    };

    const silentConsole = { log() {}, warn() {}, error() {}, info() {}, debug() {} };

    // ----------------------------------------------------------------
    // Script instances.
    // ----------------------------------------------------------------
    function createScriptPropertiesFor(overrides) {
        return function createScriptProperties() {
            const definitions = {};
            const builder = {
                finish() {
                    const result = {};
                    for (const [name, definition] of Object.entries(definitions)) {
                        let value = hasOwn.call(overrides ?? {}, name) ? overrides[name] : definition.value;
                        if (value !== null && typeof value === "object" && "value" in value) {
                            value = value.value;
                        }
                        if (definition.kind === "color" && typeof value === "string") {
                            value = new Vec3(value);
                        }
                        result[name] = value;
                    }
                    return result;
                },
            };
            for (const kind of ["Slider", "Checkbox", "Text", "TextInput", "Color", "Combo", "File", "Directory", "Select"]) {
                builder[`add${kind}`] = definition => {
                    if (definition && typeof definition.name === "string") {
                        definitions[definition.name] = { kind: kind.toLowerCase(), value: definition.value };
                    }
                    return builder;
                };
            }
            return builder;
        };
    }

    function transformSource(source) {
        const exported = new Set();
        const bindings = [];
        // Scripts are ES modules: imports may sit anywhere at top level (minifiers
        // put them mid-line), bind before any code runs, and the body is strict.
        // `var` because the module names are also parameters of the wrapper.
        let text = String(source)
            .replace(/\bimport\s*(?:\*\s*as\s+([\w$]+)|\{([^}]*)\})\s*from\s*(['"])(\w+)\3\s*;?/g, (match, all, named, quote, module) => {
                if (!hasOwn.call(MODULES, module)) {
                    return "";
                }
                if (all) {
                    bindings.push(`${all} = __modules.${module}`);
                }
                for (const part of named ? named.split(",") : []) {
                    const [imported, local = imported] = part.trim().split(/\s+as\s+/);
                    if (/^[\w$]+$/.test(imported) && /^[\w$]+$/.test(local)) {
                        bindings.push(`${local} = __modules.${module}.${imported}`);
                    }
                }
                return "";
            })
            .replace(/\bexport\s+((?:async\s+)?function\s*\*?\s*(\w+)|(?:class|let|var|const)\s+(\w+))/g, (match, rest, fn, other) => {
                exported.add(fn ?? other);
                return rest;
            });
        text = `"use strict";${bindings.length ? `var ${bindings.join(", ")};` : ""}` + text;
        text += "\n;return {" + HANDLERS.map(name => `${name}: typeof ${name} === "function" ? ${name} : undefined`).join(",") + ", scriptProperties: typeof scriptProperties === \"undefined\" ? undefined : scriptProperties};";
        return { exported, text };
    }

    function parseValue(value) {
        if (typeof value === "string") {
            const parts = value.trim().split(/\s+/);
            if (parts.length >= 2 && parts.length <= 4 && parts.every(part => part !== "" && Number.isFinite(Number(part)))) {
                const numbers = parts.map(Number);
                return new (parts.length === 2 ? Vec2 : parts.length === 3 ? Vec3 : Vec4)(...numbers);
            }
        }
        return value;
    }

    function failScript(script, error) {
        script.alive = false;
        if (state.errors.length < MAX_ERRORS) {
            state.errors.push([script.id, String(error?.message ?? error).slice(0, MAX_STRING)]);
        }
    }

    function guarded(script, fn, args) {
        const previous = state.current;
        state.current = script;
        try {
            return fn.apply(script.thisArg, args);
        } catch (error) {
            failScript(script, error);
            return undefined;
        } finally {
            state.current = previous;
        }
    }

    function compileScript(spec) {
        const layer = scene.objects.get(spec.object);
        const script = {
            id: spec.id,
            object: spec.object,
            path: spec.path,
            layer,
            alive: true,
            thisArg: undefined,
            handlers: {},
            value: parseValue(spec.value),
            layerProperty: spec.path.length === 1 && LAYER_PROPERTIES.has(spec.path[0]) ? spec.path[0] : null,
            sent: undefined,
        };
        try {
            const { text } = transformSource(spec.source);
            const factory = new nativeFunction(
                "thisLayer", "thisObject", "thisScene", "engine", "shared", "input", "console",
                "createScriptProperties", "Vec2", "Vec3", "Vec4", "WEMath", "WEColor", "WEVector",
                "localStorage", "MediaPlaybackEvent", "__modules",
                text
            );
            const exported = factory(
                layer, layer, thisScene, engine, shared, cursorInput, silentConsole,
                createScriptPropertiesFor(spec.properties), Vec2, Vec3, Vec4, WEMath, WEColor, WEVector,
                localStorageApi, MediaPlaybackEvent, MODULES
            );
            script.handlers = exported;
        } catch (error) {
            failScript(script, error);
        }
        return script;
    }

    function currentValue(script) {
        if (script.layerProperty && script.layer) {
            return script.layer.values[script.layerProperty];
        }
        return script.value;
    }

    function storeResult(script, result) {
        if (result === undefined) {
            return;
        }
        if (script.layerProperty && script.layer) {
            script.layer[script.layerProperty] = result;
        } else {
            script.value = result;
        }
    }

    function encodeValue(value) {
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "string") {
            return value.slice(0, MAX_STRING);
        }
        if (value !== null && typeof value === "object") {
            const out = [];
            for (const key of ["x", "y", "z", "w"]) {
                if (typeof value[key] === "number" && Number.isFinite(value[key])) {
                    out.push(value[key]);
                }
            }
            return out.length ? out : null;
        }
        return null;
    }

    function initScript(script) {
        const { init, applyUserProperties } = script.handlers;
        if (script.alive && init) {
            storeResult(script, guarded(script, init, [currentValue(script)]));
        }
        if (script.alive && applyUserProperties) {
            guarded(script, applyUserProperties, [user]);
        }
    }

    function dispatchEvent(type, objectId, x, y) {
        const event = {
            x,
            y,
            worldPosition: new Vec3(x, y, 0),
            screenPosition: new Vec2(input.screen[0], input.screen[1]),
        };
        for (const script of scripts) {
            if (script.alive && script.object === objectId && script.handlers[type]) {
                guarded(script, script.handlers[type], [event]);
            }
        }
    }

    function runTimers() {
        const due = clock.timers.filter(timer => timer.at <= clock.runtime);
        if (!due.length) {
            return;
        }
        for (const timer of due) {
            if (timer.repeat) {
                timer.at = clock.runtime + nativeMath.max(timer.delay, 0.001);
            } else {
                removeTimer(timer.id);
            }
            if (timer.script?.alive !== false) {
                guarded(timer.script ?? { alive: true }, timer.callback, []);
            }
        }
    }

    function pushChange(change) {
        if (state.changes.length < MAX_CHANGES) {
            state.changes.push(change);
        } else {
            state.dropped++;
        }
    }

    function collectLayerChanges() {
        for (const layer of watched) {
            const now = layer.snapshot();
            const before = layer.sent;
            const id = layer.id;
            if (now[0] !== before[0]) {
                pushChange([0, id, "visible", now[0] === 1]);
            }
            if (now[1] !== before[1]) {
                pushChange([0, id, "alpha", now[1]]);
            }
            if (now[2] !== before[2] || now[3] !== before[3] || now[4] !== before[4]) {
                pushChange([0, id, "origin", [now[2], now[3], now[4]]]);
            }
            if (now[5] !== before[5] || now[6] !== before[6] || now[7] !== before[7]) {
                pushChange([0, id, "scale", [now[5], now[6], now[7]]]);
            }
            if (now[8] !== before[8] || now[9] !== before[9] || now[10] !== before[10]) {
                pushChange([0, id, "angles", [now[8], now[9], now[10]]]);
            }
            if (now[11] !== before[11] || now[12] !== before[12] || now[13] !== before[13]) {
                pushChange([0, id, "color", [now[11], now[12], now[13]]]);
            }
            if (now[14] !== before[14] || now[15] !== before[15]) {
                pushChange([0, id, "parallaxDepth", [now[14], now[15]]]);
            }
            layer.sent = now;
            if (layer.values.text !== layer.sentText) {
                layer.sentText = layer.values.text;
                pushChange([0, id, "text", layer.sentText.slice(0, MAX_STRING)]);
            }
            if (layer.dirtyFrame >= 0) {
                pushChange([0, id, "frame", layer.dirtyFrame]);
                layer.dirtyFrame = -1;
            }
        }
    }

    function collectScriptChanges() {
        for (const script of scripts) {
            if (!script.alive || script.layerProperty) {
                continue;
            }
            const encoded = encodeValue(script.value);
            if (encoded === null) {
                continue;
            }
            const key = typeof encoded === "object" ? encoded.join(",") : encoded;
            if (key !== script.sent) {
                script.sent = key;
                pushChange([1, script.id, null, encoded]);
            }
        }
    }

    // ----------------------------------------------------------------
    // Message handling.
    // ----------------------------------------------------------------
    function send(message) {
        port.postMessage(message);
    }

    function onInit(message) {
        scene.projection = message.projection;
        for (const data of message.objects) {
            const handle = new LayerHandle(data);
            scene.objects.set(handle.id, handle);
            scene.order.push(handle);
            if (!scene.byName.has(handle.name)) {
                scene.byName.set(handle.name, handle);
            }
        }
        for (const [name, entry] of Object.entries(message.userProperties ?? {})) {
            user[name] = parseValue(entry);
        }
        for (const spec of message.scripts) {
            scripts.push(compileScript(spec));
        }
        for (const script of scripts) {
            initScript(script);
        }
        for (const script of scripts) {
            if (script.alive) {
                for (const name of CURSOR_EVENTS) {
                    if (script.handlers[name]) {
                        interactive.add(script.object);
                    }
                }
            }
        }
        collectLayerChanges();
        collectScriptChanges();
        const continuous = scripts.some(script => script.alive && script.handlers.update);
        send({
            t: "ready",
            changes: state.changes.splice(0),
            continuous,
            errors: state.errors.splice(0),
            interactive: [...interactive],
        });
    }

    function onTick(message) {
        clock.runtime = message.time;
        clock.frametime = message.dt;
        input.world = message.world;
        input.screen = message.screen;
        input.leftDown = message.down;
        for (const [type, objectId, x, y] of message.events) {
            dispatchEvent(type, objectId, x, y);
        }
        runTimers();
        for (const script of scripts) {
            if (script.alive && script.handlers.update) {
                storeResult(script, guarded(script, script.handlers.update, [currentValue(script)]));
            }
        }
        collectLayerChanges();
        collectScriptChanges();
        send({
            t: "tick",
            changes: state.changes.splice(0),
            dropped: state.dropped,
            errors: state.errors.splice(0),
            seq: message.seq,
        });
        state.dropped = 0;
    }

    function onMessage(event) {
        const message = event.data;
        try {
            if (message.t === "init") {
                onInit(message);
            } else if (message.t === "tick") {
                onTick(message);
            }
        } catch (error) {
            send({ t: "fatal", error: String(error?.message ?? error).slice(0, MAX_STRING) });
        }
    }

    self.addEventListener("message", function first(event) {
        const transferred = event.data?.port;
        if (!transferred) {
            return;
        }
        self.removeEventListener("message", first);
        port = transferred;
        lockDown();
        port.onmessage = onMessage;
        port.postMessage({ t: "hello" });
    });
}

export const WORKER_SOURCE = `(${workerMain.toString()})();`;
