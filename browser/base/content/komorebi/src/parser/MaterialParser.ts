/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { ShaderParser } from "./ShaderParser.js";
import type { ResolvedMaterialPass } from "../types/Material.js";

export interface EffectPassOverride {
  textures?: Record<string, string | { name?: string } | undefined>;
  combos?: Record<string, unknown>;
  constantshadervalues?: Record<string, unknown>;
  binds?: Record<string, string>;
}

export interface RawMaterialEffect {
  visible?: boolean | { value?: boolean };
  file?: string;
  passes?: EffectPassOverride[];
}

interface EffectBindDeclaration {
  index: number;
  name: string;
}

interface EffectDefinitionPass {
  material?: string;
  target?: string | null;
  // Index -> named render target, resolved by EffectRenderer at render time rather than through the texture loader.
  bind?: EffectBindDeclaration[];
  command?: string;
  source?: string;
}

interface EffectDefinition {
  passes?: EffectDefinitionPass[];
}

interface MaterialPassSource {
  shader: string;
  textures?: Record<string, string | { name?: string } | undefined>;
  combos?: Record<string, unknown>;
  constantshadervalues?: Record<string, unknown>;
  blending?: string;
  cullmode?: string;
  depthtest?: string;
  depthwrite?: string;
}

interface MaterialSource {
  passes?: MaterialPassSource[];
}

export class MaterialParser {
  readonly entries: Map<string, Uint8Array>;
  readonly #decoder: TextDecoder;
  readonly #shaders: ShaderParser;

  constructor(entries: Map<string, Uint8Array>) {
    this.entries = entries;
    this.#decoder = new TextDecoder();
    this.#shaders = new ShaderParser(entries);
  }

  resolveEffects(effects: RawMaterialEffect[] = []): ResolvedMaterialPass[] {
    return effects
      .filter(effect => {
        const visible = effect.visible;
        return (
          visible !== false &&
          !(
            typeof visible === "object" &&
            visible !== null &&
            visible.value === false
          )
        );
      })
      .flatMap(effect => this.resolveEffect(effect));
  }

  resolveEffect(effect: RawMaterialEffect): ResolvedMaterialPass[] {
    const definition = this.readJSON<EffectDefinition>(effect.file);
    if (!definition?.passes) {
      return [];
    }
    return definition.passes.flatMap((definitionPass, effectPassIndex) => {
      const overrides = effect.passes?.[effectPassIndex] || {};
      if (!definitionPass.material) {
        // A pass without a material is a "copy" command: snapshot `source` into `target` via a passthrough shader.
        if (
          definitionPass.command === "copy" &&
          definitionPass.source &&
          definitionPass.target
        ) {
          return [
            this.resolvePass(
              {
                blending: "normal",
                cullmode: "nocull",
                depthtest: "disabled",
                depthwrite: "disabled",
                shader: "commands/copy",
                textures: { "0": definitionPass.source },
              },
              {},
              effectPassIndex,
              0,
              definitionPass
            ),
          ];
        }
        return [];
      }
      const material = this.readJSON<MaterialSource>(definitionPass.material);
      return (material?.passes || []).map((pass, materialPassIndex) =>
        this.resolvePass(
          pass,
          overrides,
          effectPassIndex,
          materialPassIndex,
          definitionPass
        )
      );
    });
  }

  resolvePass(
    pass: MaterialPassSource,
    overrides: EffectPassOverride,
    effectPassIndex: number,
    materialPassIndex: number,
    definition: EffectDefinitionPass
  ): ResolvedMaterialPass {
    const shader = pass.shader;
    const textures = this.textureMap(
      this.#shaders.defaultTextures(shader),
      pass.textures,
      overrides.textures
    );
    const binds: Record<string, string> = { ...(overrides.binds || {}) };
    for (const bind of definition.bind || []) {
      binds[bind.index] = bind.name;
    }
    // Named render-target references ("_rt_..."/"_alias_...") can also arrive as a scene-level texture override.
    for (const [index, name] of textures) {
      if (name.startsWith("_rt_") || name.startsWith("_alias_")) {
        binds[index] = name;
        textures.delete(index);
      }
    }
    const combos: Record<string, unknown> = {
      ...(pass.combos || {}),
      ...(overrides.combos || {}),
    };
    const resolvedCombos = this.#shaders.resolveCombos(
      shader,
      combos,
      textures
    );
    const { vertex, fragment } = this.#shaders.reconcileVaryings(
      this.#shaders.compile(shader, "vert", resolvedCombos, textures),
      this.#shaders.compile(shader, "frag", resolvedCombos, textures)
    );
    return {
      binds,
      blending: pass.blending || "normal",
      combos: resolvedCombos,
      constants: {
        ...(pass.constantshadervalues || {}),
        ...(overrides.constantshadervalues || {}),
      },
      cullmode: pass.cullmode || "nocull",
      depthtest: pass.depthtest === "enabled",
      depthwrite: pass.depthwrite === "enabled",
      effectPassIndex,
      fragment,
      materialPassIndex,
      shader,
      target: definition.target || null,
      textures,
      uniforms: this.#shaders.uniformMap(shader),
      vertex,
    };
  }

  textureMap(
    ...sources: (
      | Record<string, string | { name?: string } | undefined>
      | undefined
    )[]
  ): Map<number, string> {
    const result = new Map<number, string>();
    for (const source of sources) {
      if (!source) {
        continue;
      }
      for (const [index, value] of Object.entries(source)) {
        const name = typeof value === "string" ? value : value?.name;
        if (name) {
          result.set(Number(index), name);
        }
      }
    }
    return result;
  }

  readJSON<T = unknown>(path: string | undefined): T | null {
    const source = this.readText(path);
    return source === null ? null : (JSON.parse(source) as T);
  }

  readText(path: string | undefined): string | null {
    if (path === undefined) {
      return null;
    }
    const bytes = this.entries.get(path);
    return bytes ? this.#decoder.decode(bytes) : null;
  }
}
