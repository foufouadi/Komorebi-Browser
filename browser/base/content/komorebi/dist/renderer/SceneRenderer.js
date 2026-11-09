/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { CanvasViewport } from "../core/CanvasViewport.js";
import { FrameScheduler } from "../core/FrameScheduler.js";
import { ResourceManager } from "../core/ResourceManager.js";
import { GraphicsContext } from "../graphics/GraphicsContext.js";
import { SceneLoader } from "../scene/SceneLoader.js";
import { RenderPipeline } from "./RenderPipeline.js";
const MAX_CLOCK_STEP_MS = 250;
const MIN_SPEED = 0.25;
const MAX_SPEED = 2;
export class SceneRenderer {
    #audioAllowed = true;
    #audioPlayer;
    #canvasViewport;
    #clock = 0;
    #effects = true;
    #fit = "cover";
    #lastTick = null;
    #renderScale = 1;
    #speed = 1;
    #frameScheduler;
    #graphics;
    #resourceManager;
    #sceneLoader;
    #renderPipeline;
    #loadGeneration = 0;
    #paused = false;
    #pageActive = true;
    #particles = [];
    #running = true;
    #selected = false;
    #layers = [];
    #projection = [1920, 1080];
    init({ audioPlayer }) {
        this.#canvasViewport = new CanvasViewport(() => this.#draw(performance.now()));
        this.#audioPlayer = audioPlayer;
        this.#audioPlayer.init();
        this.#graphics = new GraphicsContext(this.#canvasViewport.gl);
        this.#resourceManager = new ResourceManager(this.#graphics.gl);
        this.#sceneLoader = new SceneLoader(this.#graphics);
        this.#renderPipeline = new RenderPipeline(this.#graphics, this.#canvasViewport);
        this.#frameScheduler = new FrameScheduler(this.#canvasViewport.canvas, timestamp => this.#tick(timestamp));
    }
    get fps() {
        return this.#frameScheduler?.fps ?? 0;
    }
    async load({ assetRoot, packageSource, sceneFile, }) {
        const generation = ++this.#loadGeneration;
        const scene = await this.#sceneLoader.load(packageSource, sceneFile, assetRoot, () => generation !== this.#loadGeneration);
        if (!scene) {
            return false;
        }
        this.#releaseScene();
        const { audioTracks, projection } = scene.sceneModel;
        this.#layers = scene.layers;
        this.#particles = scene.particles;
        this.#audioPlayer.load(audioTracks);
        for (const track of audioTracks) {
            track.data = null;
        }
        this.#projection = projection;
        this.#selected = true;
        this.#clock = 0;
        this.#lastTick = null;
        this.#updateActivity();
        return true;
    }
    setVisible(visible) {
        this.#selected = visible;
        this.#updateActivity();
    }
    setPageActive(active) {
        this.#pageActive = active;
        this.#updateActivity();
    }
    setRunning(running) {
        this.#running = running;
        this.#updateActivity();
    }
    setAudioAllowed(allowed) {
        this.#audioAllowed = allowed;
        this.#updateActivity();
    }
    setAudioDucked(ducked) {
        this.#audioPlayer.setDucked(ducked);
    }
    updateSettings(settings) {
        this.#frameScheduler.setMaxFPS(settings.maxFPS);
        this.#audioPlayer.updateSettings(settings);
        const effects = settings.effects !== false;
        const fit = settings.fit ?? "cover";
        const renderScale = settings.renderScale > 0 ? settings.renderScale : 1;
        const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(settings.speed) || 1));
        const redraw = effects !== this.#effects ||
            fit !== this.#fit ||
            renderScale !== this.#renderScale;
        this.#effects = effects;
        this.#fit = fit;
        this.#renderScale = renderScale;
        this.#speed = speed;
        this.#renderPipeline.setEffectsEnabled(effects);
        this.#renderPipeline.setFit(fit);
        this.#canvasViewport.setRenderScale(renderScale);
        this.#applyPlaybackRate();
        const paused = Boolean(settings.paused);
        if (this.#paused !== paused) {
            this.#paused = paused;
            this.#updateActivity();
        }
        else if (redraw && !this.#canvasViewport.canvas.hidden) {
            this.#draw();
        }
    }
    destroy() {
        this.#loadGeneration++;
        this.#frameScheduler.stop();
        this.#canvasViewport.destroy();
        this.#releaseScene();
        this.#audioPlayer.destroy();
        this.#graphics.dispose();
    }
    #tick(timestamp) {
        if (this.#lastTick !== null) {
            const step = Math.min(MAX_CLOCK_STEP_MS, Math.max(0, timestamp - this.#lastTick));
            this.#clock += step * this.#speed;
        }
        this.#lastTick = timestamp;
        this.#draw(timestamp);
    }
    #draw(pointerTimestamp = performance.now()) {
        this.#renderPipeline.render(this.#layers, this.#particles, this.#projection, this.#clock, 0, pointerTimestamp);
    }
    #applyPlaybackRate() {
        for (const layer of this.#layers) {
            if (layer.video) {
                layer.video.playbackRate = this.#speed;
            }
        }
    }
    #updateActivity() {
        const active = this.#selected && this.#pageActive;
        this.#canvasViewport.canvas.hidden = !active;
        this.#audioPlayer.setOverlayVisible(active);
        this.#audioPlayer.setActive(this.#selected && this.#audioAllowed && !this.#paused);
        const animate = active && this.#running && !this.#paused;
        this.#setVideosActive(animate);
        if (active) {
            this.#canvasViewport.refreshBounds();
            this.#draw(performance.now());
        }
        if (animate) {
            this.#frameScheduler.start(() => this.#particles.length > 0 ||
                this.#layers.some(layer => layer.animation.active ||
                    layer.frames ||
                    layer.video ||
                    layer.renderPasses.length > 0));
        }
        else {
            this.#frameScheduler.stop();
            this.#lastTick = null;
        }
    }
    #setVideosActive(active) {
        for (const layer of this.#layers) {
            if (!layer.video) {
                continue;
            }
            if (active) {
                layer.video.playbackRate = this.#speed;
                layer.video.play().catch(() => { });
            }
            else {
                layer.video.pause();
            }
        }
    }
    #releaseScene() {
        this.#resourceManager.releaseLayers(this.#layers);
        this.#resourceManager.releaseParticles(this.#particles);
        this.#layers = [];
        this.#particles = [];
    }
}
