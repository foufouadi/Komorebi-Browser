/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export function currentFrame(frames, timestamp, animationStart) {
    const list = frames;
    if (!list?.length) {
        return null;
    }
    const total = list.reduce((sum, frame) => sum + frame.duration, 0);
    let elapsed = ((timestamp - animationStart) / 1000) % total;
    for (const frame of list) {
        if (elapsed < frame.duration) {
            return frame;
        }
        elapsed -= frame.duration;
    }
    return list.at(-1) ?? null;
}
