/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { AnimatedProperty, Keyframe } from "../types/Animation.js";

export function readProperty(source: unknown, key: string): unknown {
    if (source !== null && typeof source === "object" && key in source) {
        return (source as Record<string, unknown>)[key];
    }
    return undefined;
}

export function readNumber(value: unknown, fallback: number): number {
    const raw = readProperty(value, "value") ?? value;
    const number = Number(raw);
    return Number.isFinite(number) ? number : fallback;
}

export function pickShaderValue(values: Record<string, unknown>, ...names: string[]): unknown {
    for (const name of names) {
        if (values?.[name] !== undefined) {
            return values[name];
        }
    }
    return undefined;
}

export function compileProperty(value: unknown, fallback: number | number[]): AnimatedProperty {
    const dimensions = Array.isArray(fallback) ? fallback.length : 1;
    const source = readProperty(value, "value") ?? value ?? fallback;
    const base = vector(source, fallback, dimensions);
    const definition = readProperty(value, "animation");
    if (!definition) {
        return { base };
    }
    const channels: Keyframe[][] = Array.from({ length: dimensions }, (_unused, index) => {
        const raw = (readProperty(definition, `c${index}`) as unknown[] | undefined) || [];
        return raw
            .map(frame => ({
                frame: Number(readProperty(frame, "frame")),
                value: Number(readProperty(frame, "value")),
            }))
            .filter(frame => Number.isFinite(frame.frame) && Number.isFinite(frame.value))
            .sort((first, second) => first.frame - second.frame);
    });
    const options = readProperty(definition, "options");
    return {
        base,
        channels,
        fps: readNumber(readProperty(options, "fps"), 30),
        length: readNumber(readProperty(options, "length"), 1),
        mode: (readProperty(options, "mode") as string | undefined) || "loop",
    };
}

export function sampleProperty(
    property: AnimatedProperty | undefined,
    seconds: number,
    fallback: number | number[] = 0
): number[] {
    if (!property) {
        return Array.isArray(fallback) ? fallback : [fallback];
    }
    if (!property.channels) {
        return property.base;
    }
    let frame = seconds * (property.fps ?? 0);
    if (property.mode === "loop") {
        frame %= property.length ?? 1;
    } else {
        frame = Math.min(frame, property.length ?? 1);
    }
    return property.base.map((baseValue, index) => sampleChannel(property.channels?.[index], frame, baseValue));
}

export function isAnimated(property: AnimatedProperty): boolean {
    return property.channels?.some(channel => channel.length > 1) || false;
}

function sampleChannel(frames: Keyframe[] | undefined, current: number, fallback: number): number {
    if (!frames?.length) {
        return fallback;
    }
    const nextIndex = frames.findIndex(frame => frame.frame >= current);
    if (nextIndex <= 0) {
        return frames[Math.max(nextIndex, 0)].value;
    }
    if (nextIndex === -1) {
        return frames.at(-1)!.value;
    }
    const previous = frames[nextIndex - 1];
    const next = frames[nextIndex];
    const range = next.frame - previous.frame;
    const progress = range ? (current - previous.frame) / range : 0;
    return previous.value + (next.value - previous.value) * progress;
}

function vector(value: unknown, fallback: number | number[], dimensions: number): number[] {
    let values: unknown[];
    if (Array.isArray(value)) {
        values = value;
    } else if (typeof value === "string") {
        values = value.trim().split(/\s+/).map(Number);
    } else {
        values = [Number(value)];
    }
    const defaults = Array.isArray(fallback) ? fallback : [fallback];
    return Array.from({ length: dimensions }, (_unused, index) => {
        const number = Number(values[index] ?? values[0]);
        return Number.isFinite(number) ? number : (defaults[index] ?? defaults[0]);
    });
}
