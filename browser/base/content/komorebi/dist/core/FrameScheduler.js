export class FrameScheduler {
    #canvas;
    #draw;
    #animationFrame = null;
    constructor(canvas, draw) {
        this.#canvas = canvas;
        this.#draw = draw;
    }
    start(shouldAnimate) {
        if (this.#animationFrame !== null || this.#canvas.hidden || !shouldAnimate()) {
            return;
        }
        const tick = (timestamp) => {
            this.#animationFrame = null;
            this.#draw(timestamp);
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
