/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { SCENE_VERTEX_SHADER } from "../graphics/shaders/SceneVertexShader.js";
import { SCENE_FRAGMENT_SHADER } from "../graphics/shaders/SceneFragmentShader.js";
import type { CanvasViewport } from "../core/CanvasViewport.js";
import type { GraphicsContext } from "../graphics/GraphicsContext.js";
import { EffectRenderer } from "./EffectRenderer.js";
import { LayerRenderer } from "./LayerRenderer.js";
import { ParticleRenderer } from "./ParticleRenderer.js";
import type { PreparedLayer } from "../types/Layer.js";
import type { PreparedParticleSystem } from "../types/Particle.js";

export class RenderPipeline {
  readonly #graphics: GraphicsContext;
  readonly #canvasViewport: CanvasViewport;
  readonly #program: WebGLProgram;
  readonly #layerRenderer: LayerRenderer;
  readonly #effectRenderer: EffectRenderer;
  readonly #particleRenderer: ParticleRenderer;

  #pointer: [number, number] = [0.5, 0.5];
  #pointerTimestamp = 0;

  constructor(graphics: GraphicsContext, canvasViewport: CanvasViewport) {
    this.#graphics = graphics;
    this.#canvasViewport = canvasViewport;
    this.#program = graphics.programs.get(
      SCENE_VERTEX_SHADER,
      SCENE_FRAGMENT_SHADER
    );
    this.#effectRenderer = new EffectRenderer(graphics);
    this.#layerRenderer = new LayerRenderer(graphics, this.#program);
    this.#particleRenderer = new ParticleRenderer(graphics);
  }

  render(
    layers: PreparedLayer[],
    particles: PreparedParticleSystem[],
    projection: number[],
    timestamp: number,
    animationStart: number
  ): void {
    if (!layers.length || this.#canvasViewport.canvas.hidden) {
      return;
    }
    const gl = this.#graphics.gl;
    const { width, height } = this.#canvasViewport.syncDrawingBufferSize();

    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.#program);
    gl.enable(gl.BLEND);

    const screenRatio = width / height;
    const sceneRatio = projection[0] / projection[1];
    const sceneScale: [number, number] =
      sceneRatio > screenRatio
        ? [1, sceneRatio / screenRatio]
        : [screenRatio / sceneRatio, 1];
    gl.uniform2f(
      gl.getUniformLocation(this.#program, "uProjection"),
      projection[0],
      projection[1]
    );
    gl.uniform2f(
      gl.getUniformLocation(this.#program, "uSceneScale"),
      sceneScale[0],
      sceneScale[1]
    );
    const elapsed = (timestamp - animationStart) / 1000;
    gl.uniform1f(gl.getUniformLocation(this.#program, "uTime"), elapsed);
    const pointer = this.#samplePointer(timestamp);

    const timing = { elapsed, timestamp, animationStart };

    for (const layer of layers) {
      this.#layerRenderer.updateVideoTexture(layer);
      const sourceTexture = this.#effectRenderer.run(
        layer,
        elapsed,
        pointer,
        projection
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.useProgram(this.#program);
      this.#layerRenderer.draw(layer, sourceTexture, timing);
    }

    this.#particleRenderer.draw(particles, {
      timestamp,
      height,
      projection,
      sceneScale,
      animationStart,
    });
    gl.useProgram(this.#program);
  }

  #samplePointer(timestamp: number): [number, number] {
    const tracker = MousePosTracker;
    const { height, left, top, width } = this.#canvasViewport.bounds;
    const x = Number(tracker?._x);
    const y = Number(tracker?._y);
    const targetX = Number.isFinite(x)
      ? Math.min(1, Math.max(0, (x - left) / width))
      : this.#pointer[0];
    const targetY = Number.isFinite(y)
      ? Math.min(1, Math.max(0, (y - top) / height))
      : this.#pointer[1];
    const elapsed = Math.min(
      0.1,
      Math.max(0, (timestamp - this.#pointerTimestamp) / 1000)
    );
    const blend = this.#pointerTimestamp ? 1 - Math.exp(-elapsed * 12) : 1;
    this.#pointer[0] += (targetX - this.#pointer[0]) * blend;
    this.#pointer[1] += (targetY - this.#pointer[1]) * blend;
    this.#pointerTimestamp = timestamp;
    return this.#pointer;
  }
}
