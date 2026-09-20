/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { EffectAnimation } from "./Animation.js";
import type { CompiledMaterialPass, ResolvedMaterialPass } from "./Material.js";
import type { RawSceneObject } from "./RawScene.js";
import type { TexParseResult } from "../parser/TexParser.js";
import type { MdlPuppetMesh } from "../parser/MdlParser.js";
import type { GpuTexture } from "./Asset.js";

export interface Layer {
  additive: boolean;
  alignment: string;
  animation: EffectAnimation;
  fullscreen: boolean;

  model: Record<string, unknown>;
  object: RawSceneObject;

  opacity: number;

  origin: number[];
  rotation: number;
  scale: number[];
  size: number[];

  puppet: MdlPuppetMesh | null;
  renderPasses: ResolvedMaterialPass[];

  texture: TexParseResult;

  tint: number[];
}

export interface PreparedLayer extends Omit<Layer, "renderPasses">, GpuTexture {
  renderPasses: CompiledMaterialPass[];

  puppetPositionBuffer?: WebGLBuffer;
  puppetEffectPositionBuffer?: WebGLBuffer;
  puppetTexCoordBuffer?: WebGLBuffer;
  puppetIndexBuffer?: WebGLBuffer;
  puppetIndexCount?: number;
}
