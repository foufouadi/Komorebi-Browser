/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export class FrameScheduler {
    readonly #canvas: HTMLCanvasElement;
    readonly #draw: (timestamp: number) => void;
    #animationFrame: number | null = null;

    constructor(canvas: HTMLCanvasElement, draw: (timestamp: number) => void) {
        this.#canvas = canvas;
        this.#draw = draw;
    }

    start(shouldAnimate: () => boolean): void {
        if (this.#animationFrame !== null || this.#canvas.hidden || !shouldAnimate()) {
            return;
        }
        const tick = (timestamp: number): void => {
            this.#animationFrame = null;
            this.#draw(timestamp);
            if (!this.#canvas.hidden) {
                this.#animationFrame = requestAnimationFrame(tick);
            }
        };
        this.#animationFrame = requestAnimationFrame(tick);
    }

    stop(): void {
        if (this.#animationFrame !== null) {
            cancelAnimationFrame(this.#animationFrame);
            this.#animationFrame = null;
        }
    }
}
