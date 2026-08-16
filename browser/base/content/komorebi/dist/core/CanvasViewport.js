/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export class CanvasViewport {
    canvas;
    gl;
    #bounds = { height: 1, left: 0, top: 0, width: 1 };
    #resizeObserver;
    constructor(onResize) {
        this.canvas = this.#createCanvas();
        this.gl = this.#createContext(this.canvas);
        this.#resizeObserver = new ResizeObserver(() => {
            this.#updateBounds();
            onResize();
        });
        this.#resizeObserver.observe(document.documentElement);
        this.#updateBounds();
    }
    get bounds() {
        return this.#bounds;
    }
    refreshBounds() {
        this.#updateBounds();
    }
    syncDrawingBufferSize() {
        const scale = window.devicePixelRatio || 1;
        const width = Math.round(window.innerWidth * scale);
        const height = Math.round(window.innerHeight * scale);
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        return { width, height };
    }
    destroy() {
        this.#resizeObserver.disconnect();
        this.canvas.remove();
    }
    #createCanvas() {
        const canvas = document.createElement("canvas");
        canvas.id = "komorebi-scene-canvas";
        canvas.hidden = true;
        document.body.prepend(canvas);
        return canvas;
    }
    #createContext(canvas) {
        const gl = canvas.getContext("webgl", {
            alpha: true,
            antialias: false,
            premultipliedAlpha: true,
        });
        if (!gl) {
            throw new Error("WebGL is not available");
        }
        return gl;
    }
    #updateBounds() {
        const rect = window.windowUtils.getBoundsWithoutFlushing(this.canvas);
        this.#bounds = {
            height: Math.max(1, rect.height),
            left: rect.x,
            top: rect.y,
            width: Math.max(1, rect.width),
        };
    }
}
