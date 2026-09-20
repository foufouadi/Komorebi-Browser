/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export interface SpriteSheet {
  frames: unknown[];
}

export interface Asset {
  width: number;
  height: number;

  textureWidth: number;
  textureHeight: number;

  /** Raw TEXI0001 flags bitfield: bit0 = no interpolation, bit1 = clamp UVs. */
  flags?: number;

  spriteSheet?: SpriteSheet;

  bitmap?: ImageBitmap;
  video?: HTMLVideoElement;
  pixels?: Uint8ClampedArray;

  objectURL?: string;
}

export interface GpuTexture {
  glTexture: WebGLTexture;

  width: number;
  height: number;
  textureWidth: number;
  textureHeight: number;

  u: number;
  v: number;

  frames: unknown[] | null;

  video?: HTMLVideoElement;
  objectURL?: string;
}
