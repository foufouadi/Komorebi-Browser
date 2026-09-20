/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { GpuTexture } from "./Asset.js";

export interface UniformDeclaration {
  configuration: Record<string, unknown> | null;
  type: string;
}

export interface CompiledMaterialPass extends ResolvedMaterialPass {
  program?: WebGLProgram;
  framebuffer?: WebGLFramebuffer;
  outputTexture?: WebGLTexture;
  outputWidth?: number;
  outputHeight?: number;
  resolvedTextures?: Map<number, GpuTexture>;
  error?: unknown;
}

export interface ResolvedMaterialPass {
  binds: Record<string, string>;
  blending: string;
  combos: Record<string, unknown>;
  constants: Record<string, unknown>;
  cullmode: string;
  depthtest: boolean;
  depthwrite: boolean;
  effectPassIndex: number;
  fragment: string;
  materialPassIndex: number;
  shader: string;
  target: string | null;
  textures: Map<number, string>;
  uniforms: Map<string, UniformDeclaration>;
  vertex: string;
}
