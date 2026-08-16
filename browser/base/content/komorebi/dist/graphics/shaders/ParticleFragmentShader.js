/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export const PARTICLE_FRAGMENT_SHADER = `
    precision mediump float;
    varying float vAlpha;
    varying vec3 vColor;
    varying float vRotation;
    varying vec4 vTexRect;
    uniform sampler2D uTexture;

    void main() {
      // Reverted 2026-08-16: removing this flip did not fix particle
      // orientation and correlated with new regressions (particles sampling
      // outside their sprite rect) on other backgrounds. Restored pending a
      // properly verified fix — see docs/rapport-corrections-fond-chargers2023.md.
      vec2 point = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) - 0.5;
      float sine = sin(vRotation);
      float cosine = cos(vRotation);
      point = vec2(point.x * cosine - point.y * sine, point.x * sine + point.y * cosine) + 0.5;
      vec4 color = texture2D(uTexture, vTexRect.xy + point * vTexRect.zw);
      color.rgb *= vColor;
      color.a *= vAlpha;
      gl_FragColor = color;
    }
  `;
