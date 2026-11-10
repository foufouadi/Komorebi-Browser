/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { readNumber } from "../effects/AnimatedProperty.js";
import { ScriptSandbox } from "./ScriptSandbox.js";

const MAX_SCRIPTS = 2000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 256 * 1024;
const MAX_OBJECTS = 20000;
const MAX_CHANGES = 4096;
const MAX_QUEUED_EVENTS = 256;
const MAX_COORDINATE = 1e7;
const MAX_STRING = 256;
const MAX_STEP_SECONDS = 0.1;
const INIT_BUDGET_MS = 5000;
const TICK_BUDGET_MS = 500;
const WATCHDOG_MS = 100;
const MIN_ALPHA = 0.01;
const LAYER_PROPERTIES = new Map([
    ["visible", "boolean"],
    ["alpha", "number"],
    ["origin", 3],
    ["scale", 3],
    ["angles", 3],
    ["color", 3],
    ["parallaxDepth", 2],
    ["frame", "number"],
    ["text", "string"],
]);
const INSTANCE_OVERRIDES = new Set(["rate", "alpha", "size", "speed", "count"]);

function walkScripts(node, owner, path, found) {
    if (Array.isArray(node)) {
        node.forEach((item, index) => walkScripts(item, owner, [...path, index], found));
        return;
    }
    if (node === null || typeof node !== "object") {
        return;
    }
    if (typeof node.script === "string" && path.length) {
        found.push({
            object: owner.id,
            path,
            properties: node.scriptproperties && typeof node.scriptproperties === "object" ? node.scriptproperties : {},
            source: node.script,
            value: node.value,
        });
    }
    for (const [key, child] of Object.entries(node)) {
        if (key !== "script" && key !== "scriptproperties") {
            walkScripts(child, owner, [...path, key], found);
        }
    }
}

/** Every script bound to a property of an object, in scene order. */
export function collectScripts(scene) {
    const found = [];
    for (const object of scene.objects ?? []) {
        if (object && typeof object === "object") {
            for (const [key, child] of Object.entries(object)) {
                if (key !== "id") {
                    walkScripts(child, object, [key], found);
                }
            }
        }
    }
    let bytes = 0;
    return found
        .filter(script => script.source.length <= MAX_SCRIPT_BYTES && (bytes += script.source.length) <= MAX_SOURCE_BYTES)
        .slice(0, MAX_SCRIPTS)
        .map((script, id) => ({ ...script, id }));
}

function finiteArray(value, length) {
    return (
        Array.isArray(value) &&
        value.length === length &&
        value.every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= MAX_COORDINATE)
    );
}

function validProperty(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
    }
    if (typeof value === "boolean") {
        return true;
    }
    if (typeof value === "string") {
        return value.length <= MAX_STRING;
    }
    return Array.isArray(value) && value.length >= 1 && value.length <= 4 && finiteArray(value, value.length);
}

/**
 * Runs a scene's scripts in the sandbox and applies what they ask for: the
 * worker sends layer property changes, the page validates them and writes them
 * into the render layers between frames. It also turns the pointer into
 * cursor events for the layers whose scripts listen to them.
 */
export class SceneScripts {
    #awaiting = null;
    #buttons = [];
    #cursor = { valid: false, x: 0, y: 0 };
    #disposed = false;
    #events = [];
    #hover = null;
    #interactive = new Set();
    #lastCursor = [NaN, NaN];
    #lastTime = null;
    #layerOf = new Map();
    #model;
    #objects = new Map();
    #onChange;
    #onDisabled;
    #particleOf = new Map();
    #pressed = null;
    #ready = false;
    #sandbox = null;
    #seq = 0;
    #specs = new Map();
    #timer = null;
    #layers;
    continuous = false;

    constructor({ layers, model, onChange, onDisabled, particles, scripts, userProperties }) {
        this.#model = model;
        this.#layers = layers;
        this.#onChange = onChange;
        this.#onDisabled = onDisabled;
        for (const layer of layers) {
            if (layer.object) {
                this.#layerOf.set(Number(layer.object.id), layer);
            }
        }
        for (const system of particles) {
            if (system.objectId !== undefined) {
                this.#particleOf.set(Number(system.objectId), system);
            }
        }
        for (const spec of scripts) {
            this.#specs.set(spec.id, spec);
        }
        this.#start(scripts, userProperties).catch(error => this.#disable(error));
    }

    get interactive() {
        return this.#ready && this.#interactive.size > 0;
    }

    /** Called once per rendered frame, before the layers are drawn. */
    frame(seconds, cursor) {
        if (!this.#ready || this.#disposed) {
            return;
        }
        const step = this.#lastTime === null ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, seconds - this.#lastTime));
        this.#lastTime = seconds;
        this.#cursor = cursor;
        if (this.#interactive.size) {
            this.#pointerEvents(cursor);
        }
        if (this.#awaiting !== null || (!this.continuous && !this.#events.length)) {
            return;
        }
        this.#awaiting = { sentAt: performance.now(), seq: ++this.#seq };
        this.#sandbox.post({
            t: "tick",
            dt: step,
            down: this.#pressed !== null,
            events: this.#events.splice(0),
            screen: [cursor.x * this.#model.projection[0], (1 - cursor.y) * this.#model.projection[1]],
            seq: this.#seq,
            time: seconds,
            world: [cursor.x * this.#model.projection[0], cursor.y * this.#model.projection[1]],
        });
    }

    /** A mouse button went down or up over the wallpaper. */
    button(down) {
        if (this.#ready && this.#interactive.size && this.#buttons.length < MAX_QUEUED_EVENTS) {
            this.#buttons.push(down);
        }
    }

    dispose() {
        this.#disposed = true;
        clearInterval(this.#timer);
        this.#timer = null;
        this.#sandbox?.terminate();
        this.#sandbox = null;
        this.#events.length = 0;
        this.#buttons.length = 0;
    }

    async #start(scripts, userProperties) {
        this.#sandbox = new ScriptSandbox({
            onFailure: error => this.#disable(error),
            onMessage: data => this.#onMessage(data),
        });
        await this.#sandbox.start();
        if (this.#disposed) {
            return;
        }
        const objects = this.#describeObjects();
        this.#awaiting = { sentAt: performance.now(), seq: 0, init: true };
        this.#timer = setInterval(() => this.#watchdog(), WATCHDOG_MS);
        this.#sandbox.post({
            t: "init",
            objects,
            projection: [...this.#model.projection],
            scripts: scripts.map(({ id, object, path, properties, source, value }) => ({
                id,
                object,
                path: path.map(part => (typeof part === "number" ? part : String(part))),
                properties,
                source,
                value,
            })),
            userProperties,
        });
    }

    #describeObjects() {
        const model = this.#model;
        const objects = [];
        for (const object of model.scene.objects ?? []) {
            if (objects.length >= MAX_OBJECTS) {
                break;
            }
            const id = Number(object.id);
            if (!Number.isFinite(id)) {
                continue;
            }
            const parent = object.parent === undefined || object.parent === null ? null : Number(object.parent);
            const visible = model.boolean(object.visible, true);
            this.#objects.set(id, { children: [], hidden: !visible, id, object, parent });
            const size = model.vector(object.size, [0, 0]);
            const layer = this.#layerOf.get(id);
            objects.push({
                alpha: readNumber(object.alpha, 1),
                angles: model.vector(object.angles, [0, 0, 0]),
                color: model.vector(object.color, [1, 1, 1]),
                id,
                kind: object.image ? "image" : object.particle ? "particle" : object.text ? "text" : "node",
                name: String(object.name ?? "").slice(0, MAX_STRING),
                origin: model.vector(object.origin, [0, 0, 0]),
                parallaxDepth: model.vector(object.parallaxDepth, [1, 1]).slice(0, 2),
                parent,
                scale: model.vector(object.scale, [1, 1, 1]),
                size: layer ? [layer.size[0], layer.size[1]] : size,
                text: object.text ? model.textString(object).slice(0, MAX_STRING) : "",
                visible,
            });
        }
        for (const entry of this.#objects.values()) {
            this.#objects.get(entry.parent)?.children.push(entry);
        }
        return objects;
    }

    // ------------------------------------------------------------------
    // Worker messages
    // ------------------------------------------------------------------
    #onMessage(data) {
        if (this.#disposed || data === null || typeof data !== "object") {
            return;
        }
        switch (data.t) {
            case "ready":
                this.#awaiting = null;
                this.continuous = data.continuous === true;
                for (const id of Array.isArray(data.interactive) ? data.interactive : []) {
                    if (this.#objects.has(id) && this.#layerOf.has(id)) {
                        this.#interactive.add(id);
                    }
                }
                this.#ready = true;
                this.#report(data.errors);
                this.#apply(data.changes);
                this.#onChange();
                break;
            case "tick":
                if (this.#awaiting?.seq === data.seq) {
                    this.#awaiting = null;
                }
                this.#report(data.errors);
                this.#apply(data.changes);
                break;
            case "fatal":
                this.#disable(new Error(String(data.error).slice(0, MAX_STRING)));
                break;
        }
    }

    #report(errors) {
        if (!Array.isArray(errors)) {
            return;
        }
        for (const entry of errors.slice(0, 32)) {
            const spec = this.#specs.get(entry?.[0]);
            if (spec) {
                console.warn(
                    `Komorebi disabled a scene script (object ${spec.object}, ${spec.path.join("/")}): ${String(entry[1]).slice(0, MAX_STRING)}`
                );
            }
        }
    }

    #watchdog() {
        const waiting = this.#awaiting;
        if (!waiting || this.#disposed) {
            return;
        }
        const now = performance.now();
        // The page itself was stalled (shader compile, GC): the reply is probably queued, not late.
        if (this.#lastWatch !== undefined && now - this.#lastWatch > WATCHDOG_MS * 4) {
            waiting.sentAt += now - this.#lastWatch - WATCHDOG_MS;
        }
        this.#lastWatch = now;
        if (now - waiting.sentAt > (waiting.init ? INIT_BUDGET_MS : TICK_BUDGET_MS)) {
            this.#disable(new Error(`a script did not return within ${waiting.init ? INIT_BUDGET_MS : TICK_BUDGET_MS} ms`));
        }
    }

    #lastWatch;

    #disable(error) {
        if (this.#disposed) {
            return;
        }
        console.warn(`Komorebi disabled the scripts of this scene: ${String(error?.message ?? error)}`);
        this.dispose();
        this.continuous = false;
        this.#interactive.clear();
        this.#ready = false;
        this.#onDisabled?.();
    }

    // ------------------------------------------------------------------
    // Applying what the worker asked for. Nothing the worker sends is
    // trusted: ids, properties and values are all checked.
    // ------------------------------------------------------------------
    #apply(changes) {
        if (!Array.isArray(changes) || !changes.length) {
            return;
        }
        if (changes.length > MAX_CHANGES) {
            this.#disable(new Error("a script sent too many changes"));
            return;
        }
        const moved = new Set();
        for (const change of changes) {
            if (!Array.isArray(change) || change.length !== 4) {
                continue;
            }
            const [kind, id, key, value] = change;
            if (kind === 0) {
                this.#applyLayer(id, key, value, moved);
            } else if (kind === 1) {
                this.#applyScripted(id, value);
            }
        }
        for (const id of moved) {
            this.#relayout(id);
        }
        this.#onChange();
    }

    #applyLayer(id, key, value, moved) {
        const entry = this.#objects.get(id);
        const shape = LAYER_PROPERTIES.get(key);
        if (!entry || shape === undefined) {
            return;
        }
        const acceptable =
            shape === "boolean"
                ? typeof value === "boolean"
                : shape === "number"
                  ? typeof value === "number" && validProperty(value)
                  : shape === "string"
                    ? typeof value === "string" && value.length <= MAX_STRING
                    : finiteArray(value, shape);
        if (!acceptable) {
            return;
        }
        const layer = this.#layerOf.get(id);
        switch (key) {
            case "visible":
                entry.hidden = !value;
                this.#refreshHidden(entry);
                break;
            case "alpha":
                if (layer) {
                    layer.opacity = Math.min(1, Math.max(0, value));
                    layer.opacityAnimation = null;
                }
                break;
            case "color":
                if (layer) {
                    layer.tint = value.map(channel => Math.min(16, Math.max(0, channel)));
                }
                break;
            case "origin":
            case "scale":
            case "angles":
                entry.object[key] = value;
                moved.add(id);
                break;
            case "parallaxDepth":
                if (layer) {
                    layer.parallaxDepth = value;
                }
                break;
            case "frame":
                if (layer) {
                    layer.frameOverride = Math.floor(value);
                }
                break;
            case "text":
                if (layer?.text && layer.text.value !== value) {
                    layer.text.value = value;
                    layer.text.dirty = true;
                }
                break;
        }
    }

    #applyScripted(sid, value) {
        const spec = this.#specs.get(sid);
        if (!spec || !validProperty(value)) {
            return;
        }
        const { path } = spec;
        if (path[0] === "effects" && path[2] === "passes" && path[4] === "constantshadervalues" && path.length === 6) {
            const layer = this.#layerOf.get(spec.object);
            for (const pass of layer?.renderPasses ?? []) {
                if (pass.effectIndex === path[1] && pass.effectPassIndex === path[3]) {
                    pass.constants[path[5]] = value;
                }
            }
        } else if (path[0] === "instanceoverride" && path.length === 2 && INSTANCE_OVERRIDES.has(path[1])) {
            const system = this.#particleOf.get(spec.object);
            if (system && typeof value === "number") {
                this.#overrideParticles(system, path[1], value);
            }
        }
    }

    #overrideParticles(system, key, value) {
        if (key === "rate") {
            for (const emitter of system.emitters) {
                emitter.rate = (emitter.baseRate ?? emitter.rate) * value;
            }
        } else if (key === "alpha") {
            system.opacity = Math.max(0, value);
        } else if (key === "size") {
            system.sizeScale = Math.max(0, value);
        } else if (key === "speed") {
            system.speed = value;
        } else if (key === "count") {
            system.count = Math.max(1, Math.floor((system.baseCount ?? system.count) * value));
        }
    }

    #hiddenChain(entry) {
        for (let current = entry, depth = 0; current && depth < 32; current = this.#objects.get(current.parent), depth++) {
            if (current.hidden) {
                return true;
            }
        }
        return false;
    }

    #refreshHidden(entry) {
        const layer = this.#layerOf.get(entry.id);
        if (layer) {
            layer.hidden = this.#hiddenChain(entry);
        }
        for (const child of entry.children) {
            this.#refreshHidden(child);
        }
    }

    #relayout(id) {
        const entry = this.#objects.get(id);
        if (!entry) {
            return;
        }
        const layer = this.#layerOf.get(id);
        if (layer) {
            this.#model.resolveLayerGeometry(layer);
        }
        for (const child of entry.children) {
            this.#relayout(child.id);
        }
    }

    // ------------------------------------------------------------------
    // Pointer: hit test and cursor events
    // ------------------------------------------------------------------
    #hit(x, y) {
        const [width, height] = this.#model.projection;
        const px = x * width;
        const py = height - y * height;
        let found = null;
        // Later layers are drawn on top.
        for (const layer of this.#layers) {
            const id = Number(layer.object?.id);
            if (!this.#interactive.has(id) || layer.hidden || layer.opacity < MIN_ALPHA) {
                continue;
            }
            const dx = px - layer.origin[0];
            const dy = py - layer.origin[1];
            const sine = Math.sin(layer.rotation);
            const cosine = Math.cos(layer.rotation);
            const localX = dx * cosine + dy * sine;
            const localY = -dx * sine + dy * cosine;
            if (
                Math.abs(localX) <= (layer.size[0] * layer.scale[0]) / 2 &&
                Math.abs(localY) <= (layer.size[1] * layer.scale[1]) / 2
            ) {
                found = id;
            }
        }
        return found;
    }

    #pointerEvents(cursor) {
        const hover = cursor.valid ? this.#hit(cursor.x, cursor.y) : null;
        const [width, height] = this.#model.projection;
        const wx = cursor.x * width;
        const wy = cursor.y * height;
        const queue = this.#events;
        if (hover !== this.#hover) {
            if (this.#hover !== null) {
                queue.push(["cursorLeave", this.#hover, wx, wy]);
            }
            if (hover !== null) {
                queue.push(["cursorEnter", hover, wx, wy]);
            }
            this.#hover = hover;
        } else if (hover !== null && (wx !== this.#lastCursor[0] || wy !== this.#lastCursor[1])) {
            queue.push(["cursorMove", hover, wx, wy]);
        }
        this.#lastCursor[0] = wx;
        this.#lastCursor[1] = wy;
        for (const down of this.#buttons.splice(0)) {
            if (down) {
                this.#pressed = hover;
                if (hover !== null) {
                    queue.push(["cursorDown", hover, wx, wy]);
                }
            } else {
                if (hover !== null) {
                    queue.push(["cursorUp", hover, wx, wy]);
                    if (this.#pressed === hover) {
                        queue.push(["cursorClick", hover, wx, wy]);
                    }
                }
                this.#pressed = null;
            }
        }
        if (queue.length > MAX_QUEUED_EVENTS) {
            queue.splice(0, queue.length - MAX_QUEUED_EVENTS);
        }
    }
}
