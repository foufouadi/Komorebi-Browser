/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { SceneAudioPlayer } from "../audio/SceneAudioPlayer.js";
import { CanvasViewport } from "../core/CanvasViewport.js";
import { FrameScheduler } from "../core/FrameScheduler.js";
import { ResourceManager } from "../core/ResourceManager.js";
import { GraphicsContext } from "../graphics/GraphicsContext.js";
import { SceneLoader } from "../scene/SceneLoader.js";
import { RenderPipeline } from "./RenderPipeline.js";
import type { PreparedLayer } from "../types/Layer.js";
import type { PreparedParticleSystem } from "../types/Particle.js";

export class SceneRenderer {
  #animationStart = 0;
  #audioPlayer!: SceneAudioPlayer;
  #canvasViewport!: CanvasViewport;
  #frameScheduler!: FrameScheduler;
  #graphics!: GraphicsContext;
  #resourceManager!: ResourceManager;
  #sceneLoader!: SceneLoader;
  #renderPipeline!: RenderPipeline;
  #loadGeneration = 0;
  #pageActive = true;
  #particles: PreparedParticleSystem[] = [];
  #selected = false;
  #layers: PreparedLayer[] = [];
  #projection: number[] = [1920, 1080];

  init(): void {
    this.#canvasViewport = new CanvasViewport(() =>
      this.#draw(performance.now())
    );
    this.#audioPlayer = new SceneAudioPlayer();
    this.#audioPlayer.init();
    this.#graphics = new GraphicsContext(this.#canvasViewport.gl);
    this.#resourceManager = new ResourceManager(this.#graphics.gl);
    this.#sceneLoader = new SceneLoader(this.#graphics);
    this.#renderPipeline = new RenderPipeline(
      this.#graphics,
      this.#canvasViewport
    );
    this.#frameScheduler = new FrameScheduler(
      this.#canvasViewport.canvas,
      timestamp => this.#draw(timestamp)
    );
  }

  async load({
    assetRoot,
    packageSource,
    sceneFile,
  }: {
    assetRoot?: string | null;
    packageSource: string;
    sceneFile: string;
  }): Promise<boolean> {
    const generation = ++this.#loadGeneration;
    const scene = await this.#sceneLoader.load(
      packageSource,
      sceneFile,
      assetRoot,
      () => generation !== this.#loadGeneration
    );
    if (!scene) {
      return false;
    }
    this.#releaseScene();
    this.#layers = scene.layers;
    this.#particles = scene.particles;
    this.#audioPlayer.load(scene.sceneModel.audioTracks);
    this.#projection = scene.sceneModel.projection;
    this.#selected = true;
    this.#animationStart = performance.now();
    this.#updateActivity();
    return true;
  }

  setVisible(visible: boolean): void {
    this.#selected = visible;
    this.#updateActivity();
  }

  setPageActive(active: boolean): void {
    this.#pageActive = active;
    this.#updateActivity();
  }

  updateSettings(settings: { muted: boolean; volume: number }): void {
    this.#audioPlayer.updateSettings(settings);
  }

  destroy(): void {
    this.#loadGeneration++;
    this.#frameScheduler.stop();
    this.#canvasViewport.destroy();
    this.#releaseScene();
    this.#audioPlayer.destroy();
    this.#graphics.dispose();
  }

  #draw(timestamp: number = performance.now()): void {
    this.#renderPipeline.render(
      this.#layers,
      this.#particles,
      this.#projection,
      timestamp,
      this.#animationStart
    );
  }

  #updateActivity(): void {
    const active = this.#selected && this.#pageActive;
    this.#canvasViewport.canvas.hidden = !active;
    this.#audioPlayer.setActive(active);
    this.#setVideosActive(active);
    if (active) {
      this.#canvasViewport.refreshBounds();
      this.#draw(performance.now());
      this.#frameScheduler.start(
        () =>
          this.#particles.length > 0 ||
          this.#layers.some(
            layer =>
              layer.animation.active ||
              layer.frames ||
              layer.video ||
              layer.renderPasses.length > 0
          )
      );
    } else {
      this.#frameScheduler.stop();
    }
  }

  #setVideosActive(active: boolean): void {
    for (const layer of this.#layers) {
      if (!layer.video) {
        continue;
      }
      if (active) {
        layer.video.play().catch(() => {});
      } else {
        layer.video.pause();
      }
    }
  }

  #releaseScene(): void {
    this.#resourceManager.releaseLayers(this.#layers);
    this.#resourceManager.releaseParticles(this.#particles);
    this.#layers = [];
    this.#particles = [];
  }
}
