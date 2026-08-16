/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export const SCENE_VERTEX_SHADER = `
    attribute vec2 aPosition;
    attribute vec2 aTexCoord;
    varying vec2 vTexCoord;
    uniform vec2 uOrigin;
    uniform vec2 uProjection;
    uniform float uRotation;
    uniform vec2 uSceneScale;
    uniform vec2 uSize;

    void main() {
      float sine = sin(uRotation);
      float cosine = cos(uRotation);
      vec2 localPosition = aPosition * uSize;
      vec2 worldPosition = uOrigin + vec2(
        localPosition.x * cosine - localPosition.y * sine,
        localPosition.x * sine + localPosition.y * cosine
      );
      vec2 clipPosition = vec2(
        worldPosition.x / uProjection.x * 2.0 - 1.0,
        1.0 - worldPosition.y / uProjection.y * 2.0
      );
      gl_Position = vec4(clipPosition * uSceneScale, 0.0, 1.0);
      vTexCoord = aTexCoord;
    }
  `;
