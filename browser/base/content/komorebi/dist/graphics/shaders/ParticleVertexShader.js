/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export const PARTICLE_VERTEX_SHADER = `
    attribute vec4 aParticle;
    attribute vec3 aParticleColor;
    attribute float aParticleRotation;
    attribute vec4 aParticleTexRect;
    varying float vAlpha;
    varying vec3 vColor;
    varying float vRotation;
    varying vec4 vTexRect;
    uniform float uPixelScale;
    uniform vec2 uProjection;
    uniform vec2 uSceneScale;

    void main() {
      vec2 clipPosition = vec2(
        aParticle.x / uProjection.x * 2.0,
        aParticle.y / uProjection.y * 2.0
      );
      gl_Position = vec4(clipPosition * uSceneScale, 0.0, 1.0);
      gl_PointSize = max(1.0, aParticle.z * uPixelScale);
      vAlpha = aParticle.w;
      vColor = aParticleColor;
      vRotation = aParticleRotation;
      vTexRect = aParticleTexRect;
    }
  `;
