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
import { rasterizeText } from "../graphics/TextRasterizer.js";
import { fillPuppetArrays } from "../scene/PuppetAnimator.js";
import { SceneLoader } from "../scene/SceneLoader.js";
import { SceneScripts } from "../script/SceneScripts.js";
import { RenderPipeline } from "./RenderPipeline.js";
const MAX_CLOCK_STEP_MS = 250;
const MIN_SPEED = 0.25;
const MAX_SPEED = 2;
export class SceneRenderer {
    #animate = false;
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
    #textLayers = [];
    #puppetLayers = [];
    #puppetClock = 0;
    #projection = [1920, 1080];
    #clearColor = null;
    #cameraMoves = false;
    #cursorState = { valid: false, x: 0, y: 0 };
    #renderOptions = null;
    #scripts = null;
    #wakePending = false;
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
        this.#textLayers = scene.layers.filter(layer => layer.text);
        this.#puppetLayers = scene.layers.filter(layer => layer.puppetAnimation);
        this.#puppetClock = 0;
        this.#particles = scene.particles;
        this.#audioPlayer.load(audioTracks);
        for (const track of audioTracks) {
            track.data = null;
        }
        this.#projection = projection;
        this.#clearColor = scene.sceneModel.clearColor;
        this.#prepareCamera(scene.sceneModel);
        this.#startScripts(scene);
        this.#selected = true;
        this.#clock = 0;
        this.#lastTick = null;
        this.#updateActivity();
        return true;
    }
    /** A mouse button went down or up over the wallpaper. */
    pointerButton(down) {
        if (this.#scripts) {
            this.#scripts.button(down);
            this.#wake();
        }
    }
    /** The pointer position the page tracks has changed. */
    pointerMoved() {
        if (this.#scripts?.interactive) {
            this.#wake();
        }
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
        this.#runScripts();
        this.#draw(timestamp);
    }
    #draw(pointerTimestamp = performance.now()) {
        if (this.#textLayers.length) {
            this.#refreshText();
        }
        if (this.#puppetLayers.length) {
            this.#updatePuppets();
        }
        this.#renderPipeline.render(this.#layers, this.#particles, this.#projection, this.#clock, 0, pointerTimestamp, this.#clearColor, this.#renderOptions);
    }
    #updatePuppets() {
        const gl = this.#graphics.gl;
        const delta = Math.max(0, this.#clock - this.#puppetClock) / 1000;
        this.#puppetClock = this.#clock;
        for (const layer of this.#puppetLayers) {
            const state = layer.puppetAnimation;
            if (layer.hidden || (!delta && state.uploaded)) {
                continue;
            }
            state.uploaded = true;
            state.animator.advance(delta);
            state.animator.skin(state.skinned);
            fillPuppetArrays(layer, state.skinned, state.positions, state.effectPositions, state.outputTexCoords);
            gl.bindBuffer(gl.ARRAY_BUFFER, layer.puppetPositionBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.positions);
            gl.bindBuffer(gl.ARRAY_BUFFER, layer.puppetEffectPositionBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.effectPositions);
            gl.bindBuffer(gl.ARRAY_BUFFER, layer.puppetOutputTexCoordBuffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.outputTexCoords);
        }
    }
    // Only text whose string changed is drawn again.
    #refreshText() {
        for (const layer of this.#textLayers) {
            const state = layer.text;
            if (state.dirty && !layer.hidden) {
                state.dirty = false;
                const pixels = rasterizeText(state);
                const resized = state.resized;
                if (resized) {
                    state.resized = false;
                    this.#resizeText(layer);
                }
                this.#graphics.textures.update(layer.glTexture, pixels, state.pixelWidth, state.pixelHeight, resized);
            }
        }
    }
    // Text that outgrew its texture: the layer, and the targets of its effect passes, follow the new size.
    #resizeText(layer) {
        const gl = this.#graphics.gl;
        const state = layer.text;
        layer.width = layer.textureWidth = state.pixelWidth;
        layer.height = layer.textureHeight = state.pixelHeight;
        layer.size = [state.box[0] + 2 * state.margin[0], state.box[1] + 2 * state.margin[1]];
        for (const pass of layer.renderPasses) {
            if (pass.outputTexture) {
                gl.bindTexture(gl.TEXTURE_2D, pass.outputTexture);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, layer.width, layer.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
                pass.outputWidth = layer.width;
                pass.outputHeight = layer.height;
            }
        }
    }
    #prepareCamera(model) {
        const camera = model.camera;
        let maxDepth = 0;
        for (const layer of this.#layers) {
            maxDepth = Math.max(maxDepth, Math.abs(layer.parallaxDepth[0]), Math.abs(layer.parallaxDepth[1]));
        }
        if (model.scripts.some(script => script.path[0] === "parallaxDepth")) {
            maxDepth = Math.max(maxDepth, 1.5);
        }
        if (!maxDepth) {
            camera.parallax = null;
        }
        camera.maxDepth = maxDepth;
        this.#cameraMoves = Boolean(camera.parallax || camera.shake);
        this.#renderOptions = { camera, captureSize: model.captureSize };
    }
    #startScripts(scene) {
        const { sceneModel } = scene;
        this.#scripts?.dispose();
        this.#scripts = null;
        if (!sceneModel.scripts.length) {
            return;
        }
        this.#scripts = new SceneScripts({
            layers: this.#layers,
            model: sceneModel,
            onChange: () => this.#wake(),
            onDisabled: () => {
                this.#scripts = null;
                this.#updateActivity();
            },
            particles: this.#particles,
            scripts: sceneModel.scripts,
            userProperties: scene.userProperties,
        });
    }
    #runScripts() {
        if (!this.#scripts) {
            return;
        }
        const point = this.#renderPipeline.cursorToScene(this.#projection);
        const cursor = this.#cursorState;
        cursor.valid = point !== null;
        if (point) {
            cursor.x = point[0];
            cursor.y = point[1];
        }
        this.#scripts.frame(this.#clock / 1000, cursor);
    }
    // One frame outside the animation loop, for scenes that only change when a script says so.
    #wake() {
        if (this.#wakePending || this.#frameScheduler.running || !this.#animate) {
            return;
        }
        this.#wakePending = true;
        requestAnimationFrame(timestamp => {
            this.#wakePending = false;
            if (this.#animate && !this.#frameScheduler.running) {
                this.#runScripts();
                this.#draw(timestamp);
            }
        });
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
        this.#animate = animate;
        this.#setVideosActive(animate);
        if (active) {
            this.#canvasViewport.refreshBounds();
            this.#draw(performance.now());
        }
        if (animate) {
            this.#frameScheduler.start(() => this.#particles.length > 0 ||
                this.#scripts?.continuous ||
                this.#cameraMoves ||
                this.#layers.some(layer => layer.animation.active ||
                    layer.opacityAnimation ||
                    layer.frames ||
                    layer.puppetAnimation ||
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
        this.#scripts?.dispose();
        this.#scripts = null;
        this.#resourceManager.releaseLayers(this.#layers);
        this.#resourceManager.releaseParticles(this.#particles);
        this.#layers = [];
        this.#textLayers = [];
        this.#puppetLayers = [];
        this.#particles = [];
    }
}
