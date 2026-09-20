/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export interface RawSceneObject {
    id: string | number;
    parent?: string | number | null;
    dependencies?: (string | number)[];
    visible?: unknown;
    image?: string;
    particle?: string;
    sound?: string[];
    playbackmode?: string;
    startsilent?: boolean;
    name?: string;
    volume?: unknown;
    effects?: unknown[];
    alignment?: string;
    alpha?: unknown;
    origin?: unknown;
    angles?: unknown;
    scale?: unknown;
    size?: unknown;
    color?: unknown;
    instanceoverride?: Record<string, unknown>;
    text?: unknown;
}

export interface RawScene {
    general?: { orthogonalprojection?: unknown };
    objects?: RawSceneObject[];
}

export interface RawPackage {
    entries: Map<string, Uint8Array>;
    scene: RawScene;
    version: string;
}
