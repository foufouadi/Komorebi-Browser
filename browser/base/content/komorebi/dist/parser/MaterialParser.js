import { ShaderParser } from "./ShaderParser.js";
export class MaterialParser {
    entries;
    #decoder;
    #shaders;
    constructor(entries) {
        this.entries = entries;
        this.#decoder = new TextDecoder();
        this.#shaders = new ShaderParser(entries);
    }
    resolveEffects(effects = []) {
        return effects
            .filter(effect => {
            const visible = effect.visible;
            return (visible !== false &&
                !(typeof visible === "object" &&
                    visible !== null &&
                    visible.value === false));
        })
            .flatMap(effect => this.resolveEffect(effect));
    }
    resolveEffect(effect) {
        const definition = this.readJSON(effect.file);
        if (!definition?.passes) {
            return [];
        }
        return definition.passes.flatMap((definitionPass, effectPassIndex) => {
            const overrides = effect.passes?.[effectPassIndex] || {};
            if (!definitionPass.material) {
                // A pass without a material is a "copy" command: snapshot `source` into `target` via a passthrough shader.
                if (definitionPass.command === "copy" &&
                    definitionPass.source &&
                    definitionPass.target) {
                    return [
                        this.resolvePass({
                            blending: "normal",
                            cullmode: "nocull",
                            depthtest: "disabled",
                            depthwrite: "disabled",
                            shader: "commands/copy",
                            textures: { "0": definitionPass.source },
                        }, {}, effectPassIndex, 0, definitionPass),
                    ];
                }
                return [];
            }
            const material = this.readJSON(definitionPass.material);
            return (material?.passes || []).map((pass, materialPassIndex) => this.resolvePass(pass, overrides, effectPassIndex, materialPassIndex, definitionPass));
        });
    }
    resolvePass(pass, overrides, effectPassIndex, materialPassIndex, definition) {
        const shader = pass.shader;
        const textures = this.textureMap(this.#shaders.defaultTextures(shader), pass.textures, overrides.textures);
        const binds = { ...(overrides.binds || {}) };
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
        const combos = {
            ...(pass.combos || {}),
            ...(overrides.combos || {}),
        };
        const resolvedCombos = this.#shaders.resolveCombos(shader, combos, textures);
        const { vertex, fragment } = this.#shaders.reconcileVaryings(this.#shaders.compile(shader, "vert", resolvedCombos, textures), this.#shaders.compile(shader, "frag", resolvedCombos, textures));
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
    textureMap(...sources) {
        const result = new Map();
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
    readJSON(path) {
        const source = this.readText(path);
        return source === null ? null : JSON.parse(source);
    }
    readText(path) {
        if (path === undefined) {
            return null;
        }
        const bytes = this.entries.get(path);
        return bytes ? this.#decoder.decode(bytes) : null;
    }
}
