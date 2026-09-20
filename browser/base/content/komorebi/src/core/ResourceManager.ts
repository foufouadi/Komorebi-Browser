/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { PreparedLayer } from "../types/Layer.js";
import type { PreparedParticleSystem } from "../types/Particle.js";

export class ResourceManager {
  readonly #gl: WebGLRenderingContext;

  constructor(gl: WebGLRenderingContext) {
    this.#gl = gl;
  }

  releaseLayers(layers: PreparedLayer[]): void {
    const gl = this.#gl;
    for (const layer of layers) {
      const releasedTextures = new Set<WebGLTexture>([layer.glTexture]);
      this.#releaseMedia(layer);
      gl.deleteTexture(layer.glTexture);
      if (layer.puppetPositionBuffer)
        gl.deleteBuffer(layer.puppetPositionBuffer);
      if (layer.puppetEffectPositionBuffer)
        gl.deleteBuffer(layer.puppetEffectPositionBuffer);
      if (layer.puppetTexCoordBuffer)
        gl.deleteBuffer(layer.puppetTexCoordBuffer);
      if (layer.puppetIndexBuffer) gl.deleteBuffer(layer.puppetIndexBuffer);
      for (const pass of layer.renderPasses) {
        // pass.program is not deleted here: it is owned by GraphicsContext's
        // ProgramCache (shared across layers/passes by shader source) and is
        // released once, engine-wide, from GraphicsContext.dispose().
        if (pass.outputTexture) gl.deleteTexture(pass.outputTexture);
        if (pass.framebuffer) gl.deleteFramebuffer(pass.framebuffer);
        for (const texture of pass.resolvedTextures?.values() || []) {
          if (releasedTextures.has(texture.glTexture)) {
            continue;
          }
          releasedTextures.add(texture.glTexture);
          this.#releaseMedia(texture);
          gl.deleteTexture(texture.glTexture);
        }
      }
    }
  }

  releaseParticles(particles: PreparedParticleSystem[]): void {
    const gl = this.#gl;
    for (const particle of particles) {
      this.#releaseMedia(particle);
      gl.deleteTexture(particle.glTexture);
    }
  }

  #releaseMedia(texture: {
    video?: HTMLVideoElement;
    objectURL?: string;
  }): void {
    if (texture.video) {
      texture.video.pause();
      texture.video.removeAttribute("src");
      texture.video.load();
    }
    if (texture.objectURL) {
      URL.revokeObjectURL(texture.objectURL);
    }
  }
}
