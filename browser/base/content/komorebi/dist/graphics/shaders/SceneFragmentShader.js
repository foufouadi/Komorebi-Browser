/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export const SCENE_FRAGMENT_SHADER = `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D uTexture;
    uniform float uOpacity;
    uniform vec3 uScroll;
    uniform vec2 uScrollRepeat;
    uniform float uTime;
    uniform vec3 uTint;
    uniform vec4 uTransform;
    uniform vec2 uTransformOffset;
    uniform vec2 uTextureOrigin;
    uniform vec2 uTextureSize;

    void main() {
      vec2 uv = (vTexCoord - uTextureOrigin) / uTextureSize;
      if (uTransform.x > 0.0) {
        float sine = sin(-uTransform.y);
        float cosine = cos(-uTransform.y);
        vec2 centered = uv - 0.5;
        uv = vec2(
          centered.x * cosine - centered.y * sine,
          centered.x * sine + centered.y * cosine
        );
        uv = (uv + uTransformOffset) * uTransform.zw + 0.5;
      }
      if (uScroll.x > 0.0) {
        vec2 speed = sign(uScroll.yz) * uScroll.yz * uScroll.yz;
        uv = fract((uv + speed * uTime) * uScrollRepeat);
      }
      uv = clamp(uv, vec2(0.0), vec2(1.0)) * uTextureSize + uTextureOrigin;
      vec4 color = texture2D(uTexture, uv);
      color.rgb *= uTint;
      color.a *= uOpacity;
      gl_FragColor = color;
    }
  `;
