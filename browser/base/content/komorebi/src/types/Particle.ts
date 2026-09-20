/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { TexParseResult } from "../parser/TexParser.js";
import type { GpuTexture } from "./Asset.js";

export type ScalarRange = [number, number];

export interface VectorRange {
  min: number[];
  max: number[];
}

export interface EmitterRange {
  type: string | undefined;
  min: number[];
  max: number[];
  delay: number;
  directions: number[];
  duration: number;
  flags: number;
  instantaneous: number;
  maxPeriodicDelay: number;
  maxPeriodicDuration: number;
  minPeriodicDelay: number;
  minPeriodicDuration: number;
  origin: number[];
  rate: number;
  sign: number[];
  speed: ScalarRange;
}

export interface ParticleSystem {
  alpha: ScalarRange;
  angularVelocity: ScalarRange;
  animationMode: string | undefined;
  blending: string;
  angularDrag: number;
  angularForce: number[];
  color: VectorRange;
  colorMultiplier: number[];
  count: number;
  emitters: EmitterRange[];
  fadeIn: number;
  fadeOut: number;
  gravity: number[];
  lifetime: ScalarRange;
  opacity: number;
  origin: number[];
  projection: number[];
  rotation: ScalarRange;
  scale: number[];
  size: ScalarRange;
  sizeExponent: number;
  sizeScale: number;
  speed: number;
  sequenceMultiplier: number;
  // The particle system's own Z rotation, applied to each particle's local position at render time; distinct from `rotation` above (each particle's own spin).
  systemAngle: number;
  texture: TexParseResult;
  movementDrag: number;
  velocity: VectorRange;
  turbulence: {
    offset: number;
    scale: number;
    speed: ScalarRange;
  } | null;
}

export interface PreparedParticleSystem extends ParticleSystem, GpuTexture {}
