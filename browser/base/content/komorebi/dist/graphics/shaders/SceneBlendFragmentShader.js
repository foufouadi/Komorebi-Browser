/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// SceneFragmentShader for a layer whose colour is blended with what is drawn
// below it. Mode numbers are the ones Wallpaper Engine stores in
// "colorBlendMode"; 0 (normal) never gets here.
export const SCENE_BLEND_FRAGMENT_SHADER = `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D uTexture;
    uniform sampler2D uBackdrop;
    uniform vec2 uBackdropSize;
    uniform int uBlendMode;
    uniform float uOpacity;
    uniform vec3 uScroll;
    uniform vec2 uScrollRepeat;
    uniform float uTime;
    uniform vec3 uTint;
    uniform vec4 uTransform;
    uniform vec2 uTransformOffset;
    uniform vec2 uTextureOrigin;
    uniform vec2 uTextureSize;

    float lum(vec3 c) {
      return dot(c, vec3(0.3, 0.59, 0.11));
    }

    vec3 rgbToHsl(vec3 c) {
      float high = max(max(c.r, c.g), c.b);
      float low = min(min(c.r, c.g), c.b);
      float delta = high - low;
      float l = (high + low) * 0.5;
      float s = 0.0;
      float h = 0.0;
      if (delta > 0.0) {
        s = l < 0.5 ? delta / (high + low) : delta / (2.0 - high - low);
        if (high == c.r) {
          h = (c.g - c.b) / delta + (c.g < c.b ? 6.0 : 0.0);
        } else if (high == c.g) {
          h = (c.b - c.r) / delta + 2.0;
        } else {
          h = (c.r - c.g) / delta + 4.0;
        }
        h /= 6.0;
      }
      return vec3(h, s, l);
    }

    float hueToChannel(float p, float q, float t) {
      if (t < 0.0) t += 1.0;
      if (t > 1.0) t -= 1.0;
      if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
      if (t < 0.5) return q;
      if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
      return p;
    }

    vec3 hslToRgb(vec3 c) {
      if (c.y == 0.0) {
        return vec3(c.z);
      }
      float q = c.z < 0.5 ? c.z * (1.0 + c.y) : c.z + c.y - c.z * c.y;
      float p = 2.0 * c.z - q;
      return vec3(
        hueToChannel(p, q, c.x + 1.0 / 3.0),
        hueToChannel(p, q, c.x),
        hueToChannel(p, q, c.x - 1.0 / 3.0)
      );
    }

    float overlayChannel(float a, float b) {
      return a < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    }

    float softLightChannel(float a, float b) {
      return b < 0.5
        ? 2.0 * a * b + a * a * (1.0 - 2.0 * b)
        : sqrt(a) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b);
    }

    float dodgeChannel(float a, float b) {
      return b >= 1.0 ? b : min(a / (1.0 - b), 1.0);
    }

    float burnChannel(float a, float b) {
      return b <= 0.0 ? b : max(1.0 - (1.0 - a) / b, 0.0);
    }

    float vividChannel(float a, float b) {
      return b < 0.5 ? burnChannel(a, 2.0 * b) : dodgeChannel(a, 2.0 * (b - 0.5));
    }

    float linearLightChannel(float a, float b) {
      return b < 0.5 ? max(a + 2.0 * b - 1.0, 0.0) : min(a + 2.0 * (b - 0.5), 1.0);
    }

    float pinLightChannel(float a, float b) {
      return b < 0.5 ? min(a, 2.0 * b) : max(a, 2.0 * (b - 0.5));
    }

    float reflectChannel(float a, float b) {
      return b >= 1.0 ? b : min(a * a / (1.0 - b), 1.0);
    }

    vec3 perChannel(int mode, vec3 a, vec3 b) {
      vec3 r = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        float x = a[i];
        float y = b[i];
        float v = y;
        if (mode == 11) v = overlayChannel(x, y);
        else if (mode == 12) v = softLightChannel(x, y);
        else if (mode == 13) v = overlayChannel(y, x);
        else if (mode == 14) v = vividChannel(x, y);
        else if (mode == 15) v = linearLightChannel(x, y);
        else if (mode == 16) v = pinLightChannel(x, y);
        else if (mode == 17) v = vividChannel(x, y) < 0.5 ? 0.0 : 1.0;
        else if (mode == 21) v = reflectChannel(x, y);
        else if (mode == 22) v = reflectChannel(y, x);
        else if (mode == 3) v = burnChannel(x, y);
        else if (mode == 8) v = dodgeChannel(x, y);
        else if (mode == 7) v = 1.0 - (1.0 - x) * (1.0 - y);
        r[i] = v;
      }
      return r;
    }

    // The blended colour for a backdrop a and a layer colour b, before it is faded by the layer's opacity.
    vec3 blendColors(int mode, vec3 a, vec3 b) {
      if (mode == 1 || mode == 5) return min(a, b);
      if (mode == 2) return a * b;
      if (mode == 4 || mode == 20) return max(a + b - 1.0, 0.0);
      if (mode == 6 || mode == 10) return max(a, b);
      if (mode == 9) return min(a + b, 1.0);
      if (mode == 18) return abs(a - b);
      if (mode == 19) return a + b - 2.0 * a * b;
      if (mode == 23) return min(a, b) - max(a, b) + 1.0;
      if (mode == 24) return (a + b) * 0.5;
      if (mode == 25) return 1.0 - abs(1.0 - a - b);
      if (mode == 26) {
        vec3 ha = rgbToHsl(a);
        return hslToRgb(vec3(rgbToHsl(b).x, ha.y, ha.z));
      }
      if (mode == 27) {
        vec3 ha = rgbToHsl(a);
        return hslToRgb(vec3(ha.x, rgbToHsl(b).y, ha.z));
      }
      if (mode == 28) {
        vec3 hb = rgbToHsl(b);
        return hslToRgb(vec3(hb.x, hb.y, rgbToHsl(a).z));
      }
      if (mode == 29) {
        vec3 ha = rgbToHsl(a);
        return hslToRgb(vec3(ha.x, ha.y, rgbToHsl(b).z));
      }
      if (mode == 30) return vec3(max(a.x, max(a.y, a.z))) * b;
      if (mode == 32) return a + a * b;
      if (mode == 31) return a + b;
      return perChannel(mode, a, b);
    }

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
      float opacity = color.a * uOpacity;
      vec4 back = texture2D(uBackdrop, gl_FragCoord.xy / uBackdropSize);
      vec3 blended = blendColors(uBlendMode, back.rgb, color.rgb);
      vec3 result = uBlendMode == 31 ? back.rgb + color.rgb * opacity : mix(back.rgb, blended, opacity);
      gl_FragColor = vec4(clamp(result, 0.0, 1.0), back.a + opacity * (1.0 - back.a));
    }
  `;
