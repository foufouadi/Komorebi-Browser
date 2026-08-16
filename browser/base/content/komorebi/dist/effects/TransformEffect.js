/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { compileProperty, isAnimated, readProperty } from "./AnimatedProperty.js";
export function compileTransformEffect(values, pass) {
    return {
        angle: compileProperty(values.angle, 0),
        enabled: 1,
        mode: Number(readProperty(pass?.combos, "MODE")) || 0,
        offset: compileProperty(values.offset, [0, 0]),
        scale: compileProperty(values.scale, [1, 1]),
    };
}
export function isTransformEffectActive(effect) {
    return isAnimated(effect.angle) || isAnimated(effect.offset) || isAnimated(effect.scale);
}
export function emptyTransformEffect() {
    return {
        angle: compileProperty(0, 0),
        enabled: 0,
        mode: 0,
        normalName: null,
        offset: compileProperty([0, 0], [0, 0]),
        scale: compileProperty([1, 1], [1, 1]),
    };
}
