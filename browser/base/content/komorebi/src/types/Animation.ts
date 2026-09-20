/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export interface Keyframe {
    frame: number;
    value: number;
}

export interface AnimatedProperty {
    base: number[];
    channels?: Keyframe[][];
    fps?: number;
    length?: number;
    mode?: string;
}

export interface ScrollEffect {
    enabled: number;
    repeat: AnimatedProperty;
    speed: AnimatedProperty;
}

export interface TransformEffect {
    angle: AnimatedProperty;
    enabled: number;
    mode: number;
    normalName?: string | null;
    offset: AnimatedProperty;
    scale: AnimatedProperty;
}

export interface EffectAnimation {
    active: boolean;
    scroll: ScrollEffect;
    transform: TransformEffect;
}
