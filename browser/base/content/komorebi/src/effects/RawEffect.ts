/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export interface RawShaderPass {
    constantshadervalues?: Record<string, unknown>;
    textures?: (string | null | undefined)[];
    combos?: Record<string, unknown>;
}

export interface RawEffect {
    visible?: boolean | { value?: boolean };
    file?: string;
    passes?: RawShaderPass[];
}
