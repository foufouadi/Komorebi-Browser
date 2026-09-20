/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export interface AudioTrack {
    data: Uint8Array;
    loop: boolean;
    mimeType: string;
    startSilent: boolean;
    title: string;
    volume: number;
}

export interface LoadedAudioTrack extends AudioTrack {
    url: string;
}
