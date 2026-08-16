/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
/**
 * Matches a GLSL `#include "name.h"` (or `#include <name.h>`) directive and
 * captures the included file name. Shared between {@link ShaderParser},
 * which expands includes at compile time, and `SceneLoader`, which uses it
 * to discover shader dependencies that must be pre-fetched from the local
 * Wallpaper Engine installation before compilation runs.
 */
export const SHADER_INCLUDE_PATTERN = /^\s*#include\s+["<]([^">]+)[">].*$/gm;
export function collectIncludeNames(source) {
    return [...source.matchAll(SHADER_INCLUDE_PATTERN)].map(match => match[1]);
}
