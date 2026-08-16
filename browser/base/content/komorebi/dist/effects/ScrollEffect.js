import { compileProperty, isAnimated, readNumber } from "./AnimatedProperty.js";
export function compileScrollEffect(values) {
    return {
        enabled: 1,
        repeat: compileProperty(values.repeat, [1, 1]),
        speed: compileProperty([readNumber(values.speedx, 0), readNumber(values.speedy, 0)], [0, 0]),
    };
}
export function isScrollEffectActive(effect) {
    return isAnimated(effect.speed) || effect.speed.base.some(value => value !== 0);
}
export function emptyScrollEffect() {
    return {
        enabled: 0,
        repeat: compileProperty([1, 1], [1, 1]),
        speed: compileProperty([0, 0], [0, 0]),
    };
}
