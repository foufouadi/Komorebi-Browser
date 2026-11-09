/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
const FPS_WINDOW_MS = 2000;
const FRAME_JITTER_MS = 2;
export class FrameScheduler {
    #canvas;
    #draw;
    #animationFrame = null;
    #drawTimes = [];
    #lastDraw = 0;
    #minInterval = 0;
    constructor(canvas, draw) {
        this.#canvas = canvas;
        this.#draw = draw;
    }
    get fps() {
        const cutoff = performance.now() - FPS_WINDOW_MS;
        while (this.#drawTimes.length && this.#drawTimes[0] < cutoff) {
            this.#drawTimes.shift();
        }
        return this.#drawTimes.length / (FPS_WINDOW_MS / 1000);
    }
    setMaxFPS(maxFPS) {
        this.#minInterval = maxFPS > 0 ? 1000 / maxFPS : 0;
    }
    start(shouldAnimate) {
        if (this.#animationFrame !== null || this.#canvas.hidden || !shouldAnimate()) {
            return;
        }
        this.#lastDraw = 0;
        const tick = (timestamp) => {
            this.#animationFrame = null;
            const elapsed = timestamp - this.#lastDraw;
            if (!this.#minInterval || elapsed >= this.#minInterval - FRAME_JITTER_MS) {
                this.#lastDraw =
                    this.#minInterval && elapsed >= this.#minInterval
                        ? timestamp - (elapsed % this.#minInterval)
                        : timestamp;
                this.#draw(timestamp);
                this.#drawTimes.push(performance.now());
            }
            if (!this.#canvas.hidden) {
                this.#animationFrame = requestAnimationFrame(tick);
            }
        };
        this.#animationFrame = requestAnimationFrame(tick);
    }
    stop() {
        if (this.#animationFrame !== null) {
            cancelAnimationFrame(this.#animationFrame);
            this.#animationFrame = null;
        }
    }
}
