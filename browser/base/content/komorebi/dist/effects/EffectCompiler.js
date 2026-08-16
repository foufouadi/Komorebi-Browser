import { compileScrollEffect, emptyScrollEffect, isScrollEffectActive } from "./ScrollEffect.js";
import { compileTransformEffect, emptyTransformEffect, isTransformEffectActive } from "./TransformEffect.js";
export class EffectCompiler {
    static compile(effects = []) {
        const animation = {
            active: false,
            scroll: emptyScrollEffect(),
            transform: emptyTransformEffect(),
        };
        for (const effect of effects) {
            const visible = effect.visible;
            const hidden = visible === false ||
                (typeof visible === "object" && visible !== null && visible.value === false);
            if (hidden) {
                continue;
            }
            const file = effect.file?.toLowerCase() || "";
            const name = file.split("/").at(-2);
            const pass = effect.passes?.find(candidate => candidate.constantshadervalues || candidate.textures);
            const values = pass?.constantshadervalues || {};
            if (name === "scroll") {
                animation.scroll = compileScrollEffect(values);
                animation.active ||= isScrollEffectActive(animation.scroll);
                continue;
            }
            if (name === "transform") {
                animation.transform = compileTransformEffect(values, pass);
                animation.active ||= isTransformEffectActive(animation.transform);
                continue;
            }
            // Every other effect ("shake"/"water"/"foliage"/"iris"/"blend"/"pulse"/
            // "tint"/"opacity"/"blurprecise"/custom effects...) is not approximated
            // here: Wallpaper Engine ships them as real compiled shaders
            // (effects/<name>/effect.json + .frag/.vert), already picked up as
            // regular render passes by MaterialParser.resolveEffects() / EffectRenderer.
            // "transform" stays special-cased above because its mode-1 variant moves
            // the layer's own vertex position, which a material pass cannot do.
        }
        return animation;
    }
}
