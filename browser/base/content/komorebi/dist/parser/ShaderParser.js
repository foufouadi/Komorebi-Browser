/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { SHADER_INCLUDE_PATTERN } from "./ShaderIncludes.js";
// "commands/copy" is not a real shipped WE asset: it's the engine's own built-in passthrough shader for effect "copy" commands.
const COMMANDS_COPY_SOURCE = {
    frag: "uniform sampler2D g_Texture0;\n" +
        "varying vec2 v_TexCoord;\n" +
        "void main() {\n" +
        "  gl_FragColor = texture2D(g_Texture0, v_TexCoord);\n" +
        "}\n",
    vert: "attribute vec3 a_Position;\n" +
        "attribute vec2 a_TexCoord;\n" +
        "varying vec2 v_TexCoord;\n" +
        "void main() {\n" +
        "  gl_Position = vec4(a_Position, 1.0);\n" +
        "  v_TexCoord = a_TexCoord;\n" +
        "}\n",
};
export class ShaderParser {
    #entries;
    #decoder;
    constructor(entries) {
        this.#entries = entries;
        this.#decoder = new TextDecoder();
    }
    // Some WE shader mods declare the same `varying` name with a different
    // component count in the vertex vs the fragment stage (seen verbatim:
    // rotate2d.vert has `varying vec2 v_TexCoord;`, rotate2d.frag has
    // `varying vec3 v_TexCoord;`). GLSL's linker requires an exact type
    // match between stages ("is not linkable between attached shaders"),
    // unlike whatever WE's own HLSL-based compiler tolerates. Promoting both
    // sides to the larger size is safe: the extra components are simply
    // unused padding (confirmed unread on both sides in the concrete case
    // above), never a truncation that would drop real data.
    reconcileVaryings(vertex, fragment) {
        const sizeOf = new Map();
        const pattern = /\bvarying\s+vec([234])\s+(\w+)/g;
        for (const src of [vertex, fragment]) {
            for (const match of src.matchAll(pattern)) {
                const size = Number(match[1]);
                sizeOf.set(match[2], Math.max(sizeOf.get(match[2]) ?? 0, size));
            }
        }
        const promote = (src) => src.replace(pattern, (fullMatch, size, name) => {
            const max = sizeOf.get(name) ?? 0;
            return max > Number(size) ? `varying vec${max} ${name}` : fullMatch;
        });
        return { vertex: promote(vertex), fragment: promote(fragment) };
    }
    resolveCombos(shader, configured, textures) {
        let source = "";
        for (const extension of ["vert", "frag"]) {
            const path = `shaders/${shader}.${extension}`;
            const unit = this.#readText(path);
            if (unit !== null) {
                source += `\n${this.#resolveIncludes(unit, new Set([path]))}`;
            }
        }
        return this.#discoverCombos(source, configured, textures);
    }
    uniformMap(shader) {
        const uniforms = new Map();
        for (const extension of ["vert", "frag"]) {
            const path = `shaders/${shader}.${extension}`;
            const source = this.#readText(path);
            if (source === null) {
                continue;
            }
            for (const match of source.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)\s*;\s*(?:\/\/\s*(\{.+\}))?\s*$/gm)) {
                uniforms.set(match[2], {
                    configuration: match[3] ? this.#parseMetadata(match[3]) : null,
                    type: match[1],
                });
            }
        }
        return uniforms;
    }
    defaultTextures(shader) {
        const textures = {};
        for (const [name, declaration] of this.uniformMap(shader)) {
            const match = name.match(/^g_Texture(\d+)$/);
            const value = declaration.configuration?.default;
            if (match && typeof value === "string" && value) {
                textures[match[1]] = value;
            }
        }
        return textures;
    }
    compile(shader, extension, combos, textures) {
        const path = `shaders/${shader}.${extension}`;
        let source = shader === "commands/copy"
            ? (COMMANDS_COPY_SOURCE[extension] ?? null)
            : this.#readText(path);
        if (source === null) {
            throw new Error(`Missing shader source: ${path}`);
        }
        source = this.#resolveIncludes(source, new Set([path]));
        const discoveredCombos = this.#discoverCombos(source, combos, textures);
        source = this.#preprocessConditionals(source, discoveredCombos);
        source = this.#hoistDeclarations(source);
        source = this.#renameShadowedBuiltins(source);
        source = this.#truncateVectorArguments(source);
        source = this.#reorderScalarVectorMinMax(source);
        source = this.#reconcileVectorAssignments(source);
        source = this.#splitCompoundForCondition(source);
        source = this.#normalizeVectorConstructors(source);
        source = this.#constifyLoopBounds(source);
        source = this.#coerceIntFloatArithmetic(source);
        const defines = Object.entries(discoveredCombos)
            .map(([name, value]) => `#define ${name.toUpperCase()} ${Number(value) || 0}`)
            .join("\n");
        // WE shaders freely use fwidth/ddx/ddy (screen-space derivatives),
        // which are core in HLSL but gated behind GL_OES_standard_derivatives
        // in GLSL ES 1.00 ("no matching overloaded function" without it). The
        // extension directive must precede any non-preprocessor statement
        // (including "precision"), and is near-universally supported in
        // WebGL1, so it's cheap to always declare on fragment shaders rather
        // than parse the source to see if it's actually needed.
        const header = [
            ...(extension === "frag"
                ? ["#extension GL_OES_standard_derivatives : enable"]
                : []),
            "precision highp float;",
            "#define mul(x, y) ((y) * (x))",
            "#define lerp mix",
            "#define frac fract",
            "#define CAST2(x) vec2(x)",
            "#define CAST3(x) vec3(x)",
            "#define CAST4(x) vec4(x)",
            "#define CAST3X3(x) mat3(x)",
            "#define float2 vec2",
            "#define float3 vec3",
            "#define float4 vec4",
            "#define int2 ivec2",
            "#define int3 ivec3",
            "#define int4 ivec4",
            "#define saturate(x) clamp(x, 0.0, 1.0)",
            "#define texSample2D texture2D",
            "#define texSample2DLod texture2D",
            "#define atan2 atan",
            "#define ddx dFdx",
            "#define ddy(x) dFdy(-(x))",
            "#define fmod(x, y) ((x) - (y) * floor((x) / (y)))",
            defines,
        ].join("\n");
        return `${header}\n${source}`;
    }
    // WE's own shader compiler resolves globals across the whole composed
    // program, so a #include'd helper (e.g. common_blur.h's blur3a) is free
    // to reference a `uniform sampler2D g_Texture0;` that the including
    // shader only declares further down the file, after the #include. GLSL
    // ES requires declaration before use in the linear token stream, so once
    // #include is textually expanded in place that ordering breaks
    // ("undeclared identifier"). Hoisting every top-level uniform/varying/
    // attribute declaration to the front (conditionals are already resolved
    // by this point, so nothing here is behind an inactive #if) restores the
    // "declared anywhere in the program" semantics WE shaders assume.
    #hoistDeclarations(source) {
        const declarationPattern = /^\s*(?:uniform|varying|attribute)\s+\S+\s+\w+(?:\s*\[\s*\d+\s*\])?\s*;/;
        const declarations = [];
        const rest = [];
        for (const line of source.split("\n")) {
            (declarationPattern.test(line) ? declarations : rest).push(line);
        }
        if (!declarations.length) {
            return source;
        }
        return `${declarations.join("\n")}\n${rest.join("\n")}`;
    }
    // HLSL (what WE shaders are authored in) implicitly truncates a larger
    // vector to a function's smaller expected parameter (e.g. passing a vec4
    // where vec2 is expected keeps just .xy, with only a compiler warning).
    // GLSL ES has no such rule ("no matching overloaded function found").
    // rotateVec2's first parameter is always vec2; WE shaders commonly call
    // it directly on a packed `varying vec4` texcoord without swizzling.
    // Appending .xy is a no-op when the argument is already vec2, so this is
    // safe to apply unconditionally rather than tracking real variable types.
    #truncateVectorArguments(source) {
        return source.replace(/\brotateVec2\(\s*(\w+)\s*,/g, "rotateVec2($1.xy,");
    }
    // HLSL has no "mod" built-in (it has "fmod" instead), so some WE shaders
    // define their own `float mod(float x, float y) { ... }` helper. GLSL
    // DOES have a built-in `mod`, and forbids user code from redefining a
    // built-in name ("built-in functions cannot be redefined"). Renaming
    // every occurrence (definition and call sites alike, hence a single
    // word-boundary-scoped replace) to a non-colliding name sidesteps this
    // without needing to know every call site up front.
    #renameShadowedBuiltins(source) {
        if (/\b(?:float|vec[234])\s+mod\s*\([^;{]*\)\s*\{/.test(source)) {
            source = source.replace(/\bmod\b/g, "weUserMod");
        }
        return source;
    }
    // WebGL1's GLSL ES validator (particularly ANGLE, used by Firefox/Chrome
    // on Windows) requires a `for` loop's condition to be a single relational
    // comparison of the loop counter against a loop-invariant expression, so
    // it can statically unroll the loop. HLSL/desktop GLSL allow arbitrary
    // compound conditions; WE raymarching-style effects commonly combine the
    // loop bound with an unrelated early-exit check via "&&"
    // (`for (float i=0.0; earlyExitCond && i<numLayers; i++)`), which ANGLE
    // rejects outright ("'for' : Invalid condition"). Splitting the "&&" at
    // its top level, keeping only the loop-counter comparison in the for
    // header, and moving the other half in as a leading `if (!(...)) break;`
    // in the loop body is behaviourally identical and valid GLSL ES.
    #splitCompoundForCondition(source) {
        return source.replace(/for\s*\(\s*((?:float|int)\s+(\w+)\s*=[^;]+)\s*;\s*([^;{}]+?)\s*;\s*([^;{}]+?)\s*\)\s*\{/g, (fullMatch, init, varName, condition, increment) => {
            const parts = this.#splitTopLevel(condition, "&&");
            if (parts.length !== 2) {
                return fullMatch;
            }
            const [first, second] = parts.map(part => part.trim());
            const referencesVar = (expression) => new RegExp(`\\b${varName}\\b`).test(expression);
            const loopBound = referencesVar(first)
                ? first
                : referencesVar(second)
                    ? second
                    : null;
            const earlyExit = loopBound === first ? second : first;
            if (!loopBound || referencesVar(earlyExit)) {
                return fullMatch;
            }
            return `for (${init}; ${loopBound}; ${increment}) {\n\t\tif (!(${earlyExit})) break;`;
        });
    }
    // ANGLE's WebGL1 for-loop validator additionally requires the loop bound
    // to be provably constant, not merely a plain local variable holding a
    // literal (`float numLayers = 24.0; for (float i=0.0; i<numLayers; ...)`
    // — real case from depthparallax.frag — is rejected: "Loop index cannot
    // be compared with non-constant expression"). Desktop GLSL/HLSL have no
    // such restriction. Scoped conservatively: only promotes a bound
    // variable to `const` when its own declaration is a bare numeric literal
    // with no other identifiers, so this can never mark something const that
    // actually depends on runtime data.
    #constifyLoopBounds(source) {
        const bounds = new Set();
        for (const match of source.matchAll(/for\s*\(\s*(?:float|int)\s+(\w+)\s*=[^;]+;\s*([^;{}]+?)\s*;/g)) {
            const [, loopVar, condition] = match;
            for (const token of condition.matchAll(/\b(\w+)\b/g)) {
                if (token[1] !== loopVar) {
                    bounds.add(token[1]);
                }
            }
        }
        if (!bounds.size) {
            return source;
        }
        for (const name of bounds) {
            source = source.replace(new RegExp(`(?<!const\\s)\\b(float|int)\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`, "g"), "const $1 " + name + " = $2;");
        }
        return source;
    }
    // HLSL's min/max intrinsics accept a scalar and a vector in either
    // argument order, broadcasting the scalar. GLSL ES only defines
    // genType min/max(genType x, float y) — vector first, float second — so
    // WE shaders written as e.g. `max(0, albedo.rgb)` fail ("no matching
    // overloaded function"). min/max are commutative, so swapping the
    // arguments is exactly equivalent and always valid GLSL. Scoped to a
    // bare numeric literal followed by a simple dotted identifier to avoid
    // misparsing arbitrary nested expressions.
    #reorderScalarVectorMinMax(source) {
        // Second argument allows any paren/comma-free expression (not just a
        // bare identifier) so `max(1e-6, u_scale * 10.0)` reorders too, not
        // only the simplest `max(0, x.rgb)` shape.
        return source.replace(/\b(min|max)\(\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*,\s*([^,()]+)\)/g, "$1($3, $2)");
    }
    // HLSL allows two more implicit vector conversions GLSL ES rejects:
    // (1) assigning a scalar to a vector variable broadcasts it to every
    //     component (`vec2 strength = g_Strength * 60;` fills both x and y);
    // (2) a compound-assignment operator (/=, *=, ...) implicitly truncates a
    //     larger vector operand to the target's size (`vec2 s; s /=
    //     g_Texture0Resolution /* vec4 */;` uses just .xy). Both need to know
    //     each identifier's declared component count, so this builds that
    //     table first (from uniform/varying/attribute/local `vecN` decls)
    //     before rewriting.
    // Splits `text` on `separator` at paren-depth 0 only, so a declarator
    // list like `radial = 0.0, tangential = 0.0, center = (g_center - 0.5)`
    // splits into 3 declarators instead of getting confused by the comma
    // that could (in other shaders) appear inside a nested call's arguments.
    #splitTopLevel(text, separator) {
        const parts = [];
        let depth = 0;
        let current = "";
        for (let index = 0; index < text.length; index++) {
            const char = text[index];
            if (char === "(") {
                depth++;
            }
            else if (char === ")") {
                depth--;
            }
            if (depth === 0 && text.startsWith(separator, index)) {
                parts.push(current);
                current = "";
                index += separator.length - 1;
            }
            else {
                current += char;
            }
        }
        parts.push(current);
        return parts;
    }
    #reconcileVectorAssignments(source) {
        const sizeOf = new Map();
        for (const match of source.matchAll(/\b(?:uniform|varying|attribute)\s+vec([234])\s+(\w+)/g)) {
            sizeOf.set(match[2], Number(match[1]));
        }
        // GLSL allows multiple comma-separated declarators sharing one type,
        // each with its own optional initializer:
        // `vec2 radial = 0.0, tangential = 0.0, center = (g_center - 0.5);`
        // or with no initializer at all: `vec2 neighbor, p, diff, pos;`.
        // Excluding "{" from what can be consumed is required: without it, a
        // FUNCTION returning a vecN (`vec3 Foo(vec3 x) { const float a = 1.0;
        // ... }`, no "=" before its "{") looks just like the start of a
        // declarator list, and "up to the next ;" swallows the whole function
        // signature plus the first statement of its body — corrupting it (a
        // real regression this caused: see docs/lacunes-connues.md history).
        const localDeclaration = /\bvec([234])\s+([^;{]+);/g;
        for (const match of source.matchAll(localDeclaration)) {
            const size = Number(match[1]);
            for (const declarator of this.#splitTopLevel(match[2], ",")) {
                const name = declarator.trim().match(/^(\w+)/);
                if (name) {
                    sizeOf.set(name[1], size);
                }
            }
        }
        if (!sizeOf.size) {
            return source;
        }
        const swizzle = (count) => "xyzw".slice(0, count);
        const isVectorLooking = (expression) => /\bvec[234]\s*\(/.test(expression) ||
            /\.[xyzwrgba]{2,4}\b/.test(expression) ||
            [...expression.matchAll(/\b(\w+)\b/g)].some(token => sizeOf.has(token[1]));
        // texSample2D/texture2D always return vec4 in GLSL (regardless of the
        // source texture's actual channel count), and WE shaders commonly
        // assign the result straight into a vec2/vec3 (discarding the rest,
        // e.g. `vec3 albedo = texSample2D(...)`), relying on HLSL's implicit
        // truncation on assignment. Checked before the generic isVectorLooking
        // broadcast path below, since a texture call already "looks vector"
        // (it has a nested swizzle like `.xy` in its own arguments) and would
        // otherwise be left alone unchanged instead of truncated.
        const textureCallSize = 4;
        source = source.replace(localDeclaration, (fullMatch, size, declList) => {
            const declarators = this.#splitTopLevel(declList, ",").map(part => {
                const equals = part.indexOf("=");
                if (equals === -1) {
                    return part;
                }
                const name = part.slice(0, equals).trim();
                const expression = part.slice(equals + 1).trim();
                if (Number(size) < textureCallSize &&
                    /^(?:texSample2D|texSample2DLod|texture2D)\(/.test(expression)) {
                    return `${name} = (${expression}).${swizzle(Number(size))}`;
                }
                return isVectorLooking(expression)
                    ? part
                    : `${name} = vec${size}(${expression})`;
            });
            return `vec${size} ${declarators.join(", ")};`;
        });
        source = source.replace(/\b(\w+)\s*(\/=|\*=|\+=|-=)\s*(\w+)\s*;/g, (fullMatch, lhs, operator, rhs) => {
            const lhsSize = sizeOf.get(lhs);
            const rhsSize = sizeOf.get(rhs);
            if (!lhsSize || !rhsSize || rhsSize <= lhsSize) {
                return fullMatch;
            }
            return `${lhs} ${operator} ${rhs}.${swizzle(lhsSize)};`;
        });
        // Same HLSL-truncates-the-larger-operand rule, but for a plain binary
        // +/- between two differently-sized vectors instead of an assignment
        // (`v_TexCoord - CAST2(u_offset)`, vec3 minus vec2). CAST2/3/4(...) are
        // this file's own always-vecN macros, so their size is known without
        // needing to track a declared variable.
        const operandSize = (expression) => Number(expression.match(/^CAST([234])\(/)?.[1]) ||
            sizeOf.get(expression.trim());
        source = source.replace(/\b(\w+)\s*([+-])\s*(CAST[234]\([^()]*\)|\w+)/g, (fullMatch, lhs, operator, rhs) => {
            const lhsSize = sizeOf.get(lhs);
            const rhsSize = operandSize(rhs);
            if (!lhsSize || !rhsSize || lhsSize === rhsSize) {
                return fullMatch;
            }
            return lhsSize > rhsSize
                ? `${lhs}.${swizzle(rhsSize)} ${operator} ${rhs}`
                : `${lhs} ${operator} (${rhs}).${swizzle(lhsSize)}`;
        });
        return source;
    }
    #normalizeVectorConstructors(source) {
        source = source.replace(/(\d+(?:\.\d+)?)f\b/g, "$1");
        source = source.replace(/\b(vec[234])\(([^()\r\n]*)\)/g, (_match, type, values) => {
            const normalized = values.replace(/(^|[,\s])(-?\d+)(?=\s*(?:,|$))/g, (_value, prefix, number) => `${prefix}${number}.0`);
            return `${type}(${normalized})`;
        });
        source = source.replace(/([*/]\s*)(\d+)(?![\d.])/g, (_match, operator, value) => `${operator}${value}.0`);
        source = source.replace(/(?<![\w.])(\d+)(\s*[*/])/g, (_match, value, operator) => `${value}.0${operator}`);
        source = source.replace(/(\bfloat\s+\w+\s*=\s*)(-?\d+)(\s*;)/g, (_match, prefix, value, suffix) => `${prefix}${value}.0${suffix}`);
        source = source.replace(
        // Was scoped to an identifier/paren-led right-hand side only, missing
        // the case where BOTH sides of +/- are bare literals ("1 + 0.5 *
        // sin(...)" in the wild — see docs/lacunes-connues.md / vhs.frag
        // history): "1" sat right after a comma, not after an operator or an
        // identifier, so none of the other passes touched it, and GLSL
        // rejects `const int + vec3` outright.
        /(?<![\w.])(\d+)(\s*[+-]\s*[\w(])/g, (_match, value, expression) => `${value}.0${expression}`);
        return source
            .split("\n")
            .map(line => {
            if (/\b(?:const\s+)?int\b|\bivec[234]\b/.test(line)) {
                return line;
            }
            if (!line.includes("[")) {
                line = line.replace(/(?<![eE])([+-]\s*)(\d+)(?![\d.])/g, "$1$2.0");
            }
            return line
                .replace(/(=\s*)(-?\d+)(\s*;)/g, "$1$2.0$3")
                .replace(
            // Trailing delimiter is a lookahead, not consumed: consecutive
            // bare integer literals in the same call ("smoothstep(0, 2, x)")
            // each need "," as THEIR prefix. A consumed suffix group eats
            // the comma the next literal needs, so only every other one in
            // a run gets converted (see docs/lacunes-connues.md history).
            /([,(]\s*)(-?\d+)(?![\d.])(?=\s*[,)])/g, (_match, prefix, value) => `${prefix}${value}.0`)
                .replace(/([A-DF-Za-df-z_][\w.)]*\s*[+-]\s*)(\d+)(?![\d.])/g, "$1$2.0");
        })
            .join("\n");
    }
    // WE ships shaders written against HLSL, which implicitly promotes int to
    // float in mixed arithmetic (e.g. `float x = intVar - 1;`). GLSL ES 1.00
    // rejects that outright ("wrong operand types"). Rather than a full type
    // checker, this targets the actual failing idiom: identifiers declared
    // `int`/`const int` (including for-loop counters) that later sit directly
    // next to +,-,*,/ get wrapped in float(...). Declaration/comparison sites
    // (`int i = 0`, `i < count`, `++i`) are untouched since the name there
    // isn't adjacent to a binary arithmetic operator.
    #coerceIntFloatArithmetic(source) {
        const intNames = new Set();
        for (const match of source.matchAll(/\b(?:const\s+)?int\s+(\w+)\s*=/g)) {
            intNames.add(match[1]);
        }
        for (const match of source.matchAll(/\bfor\s*\(\s*int\s+(\w+)\b/g)) {
            intNames.add(match[1]);
        }
        if (!intNames.size) {
            return source;
        }
        const alternation = [...intNames]
            .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
        // Single-letter loop counters (i, x, y, z...) are exactly the names
        // GLSL also uses for swizzle components (.x, .y, .rgb, ...). Without
        // excluding anything preceded by "." here, `Q.x - min(...)` gets
        // corrupted into `Q.float(x) - min(...)` — a real regression this
        // caused (see docs/lacunes-connues.md / session history: `worley()`'s
        // `for (int x ...)`/`for (int y ...)` polluted every `.x`/`.y` swizzle
        // in the whole file, since tracking here is file-wide, not scoped to
        // the loop's body). Same story for `y++`/`x--` (the for-loop's own
        // increment clause): `float(y)++` is not an l-value, so `++`/`--` must
        // be excluded from the "followed by an operator" lookahead too.
        source = source.replace(new RegExp(`(?<!\\.)\\b(${alternation})\\b(?=\\s*[+\\-*/])(?!\\s*(\\+\\+|--))`, "g"), "float($1)");
        source = source.replace(new RegExp(`(?<=[+\\-*/]\\s)(?<!\\.\\s)\\b(${alternation})\\b`, "g"), "float($1)");
        return source;
    }
    #preprocessConditionals(source, configured) {
        const macros = { ...configured };
        const stack = [];
        const output = [];
        let active = true;
        for (const line of source.split(/\r?\n/)) {
            const directive = line
                .trim()
                .match(/^#(if|ifdef|ifndef|elif|else|endif)\b\s*(.*)$/);
            if (!directive) {
                if (active) {
                    output.push(line);
                    const define = line.trim().match(/^#define\s+(\w+)\s+(-?\d+)\s*$/);
                    if (define) {
                        macros[define[1]] = Number(define[2]);
                    }
                }
                continue;
            }
            const [, type, expression] = directive;
            if (type === "if" || type === "ifdef" || type === "ifndef") {
                const condition = type === "ifdef"
                    ? macros[expression] !== undefined
                    : type === "ifndef"
                        ? macros[expression] === undefined
                        : this.#evaluateCondition(expression, macros);
                stack.push({ parent: active, matched: condition });
                active = active && condition;
            }
            else if (type === "elif") {
                const state = stack.at(-1);
                const condition = !state.matched && this.#evaluateCondition(expression, macros);
                state.matched ||= condition;
                active = state.parent && condition;
            }
            else if (type === "else") {
                const state = stack.at(-1);
                const condition = !state.matched;
                state.matched = true;
                active = state.parent && condition;
            }
            else {
                const state = stack.pop();
                active = state?.parent ?? true;
            }
        }
        return output.join("\n");
    }
    #evaluateCondition(expression, macros) {
        let normalized = expression.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_match, name) => (macros[name] === undefined ? "0" : "1"));
        normalized = normalized.replace(/\b[A-Za-z_]\w*\b/g, name => String(Number(macros[name]) || 0));
        if (!/^[\d\s!<>=&|()+\-*/%]+$/.test(normalized)) {
            return false;
        }
        const tokens = normalized.match(/\d+|&&|\|\||==|!=|<=|>=|[!<>()+\-*/%]/g);
        if (!tokens) {
            return false;
        }
        let position = 0;
        const parsePrimary = () => {
            const token = tokens[position++];
            if (token === "(") {
                const value = parseOr();
                if (tokens[position++] !== ")") {
                    throw new Error("Unbalanced shader condition");
                }
                return value;
            }
            if (token === "!") {
                return Number(!parsePrimary());
            }
            if (token === "-") {
                return -parsePrimary();
            }
            return Number(token);
        };
        const binary = (next, operators) => {
            let value = next();
            while (operators.includes(tokens[position])) {
                const operator = tokens[position++];
                const right = next();
                if (operator === "*")
                    value *= right;
                else if (operator === "/")
                    value /= right;
                else if (operator === "%")
                    value %= right;
                else if (operator === "+")
                    value += right;
                else if (operator === "-")
                    value -= right;
                else if (operator === "<")
                    value = Number(value < right);
                else if (operator === "<=")
                    value = Number(value <= right);
                else if (operator === ">")
                    value = Number(value > right);
                else if (operator === ">=")
                    value = Number(value >= right);
                else if (operator === "==")
                    value = Number(value === right);
                else if (operator === "!=")
                    value = Number(value !== right);
                else if (operator === "&&")
                    value = Number(Boolean(value && right));
                else if (operator === "||")
                    value = Number(Boolean(value || right));
            }
            return value;
        };
        const parseProduct = () => binary(parsePrimary, ["*", "/", "%"]);
        const parseSum = () => binary(parseProduct, ["+", "-"]);
        const parseComparison = () => binary(parseSum, ["<", "<=", ">", ">="]);
        const parseEquality = () => binary(parseComparison, ["==", "!="]);
        const parseAnd = () => binary(parseEquality, ["&&"]);
        const parseOr = () => binary(parseAnd, ["||"]);
        try {
            const value = parseOr();
            return position === tokens.length && Boolean(value);
        }
        catch {
            return false;
        }
    }
    #discoverCombos(source, configured, textures) {
        const combos = { ...configured };
        for (const match of source.matchAll(/^\s*\/\/ \[COMBO\] (.+)$/gm)) {
            const metadata = this.#parseMetadata(match[1]);
            if (metadata?.combo !== undefined &&
                combos[metadata.combo] === undefined) {
                combos[metadata.combo] = Number(metadata.default) || 0;
            }
        }
        const uniformPattern = /^\s*uniform\s+\w+\s+(g_Texture(\d+))\s*;\s*\/\/\s*(\{.+\})\s*$/gm;
        for (const match of source.matchAll(uniformPattern)) {
            const metadata = this.#parseMetadata(match[3]);
            if (metadata?.combo !== undefined &&
                combos[metadata.combo] === undefined) {
                combos[metadata.combo] = textures.has(Number(match[2]))
                    ? 1
                    : Number(metadata.default) || 0;
            }
        }
        // Komorebi has no audio-spectrum analysis pipeline feeding
        // g_AudioSpectrum16Left/Right (see AGENTS.md search: no such uniform is
        // ever set from src/). Leaving AUDIOPROCESSING enabled would react to
        // whatever the uniform happens to default to (0), which is meaningless,
        // and its non-zero variants use a `for` loop bounded by a uniform-
        // derived value, which GLSL ES 1.00 rejects outright ("loop index
        // cannot be initialized with non-constant expression") since WebGL1 has
        // no dynamic loop bounds. Forcing it off keeps this compiling and
        // matches the fact that the feature has no real data behind it.
        if ("AUDIOPROCESSING" in combos) {
            combos.AUDIOPROCESSING = 0;
        }
        return combos;
    }
    #parseMetadata(value) {
        try {
            return JSON.parse(value);
        }
        catch {
            return null;
        }
    }
    #resolveIncludes(source, stack) {
        return source.replace(SHADER_INCLUDE_PATTERN, (_directive, name) => {
            const candidates = [`shaders/${name}`, name];
            const path = candidates.find(candidate => this.#entries.has(candidate));
            // Standard (built-in) fallbacks have no package path, so they are
            // keyed separately ("std:name") in the same guard set. The guard is
            // intentionally NOT released after expansion (unlike a plain cycle
            // guard) so it behaves like a real #pragma once: two sibling
            // #include directives pulling in the same header (e.g. a shader
            // that includes both "common.h" and "common_blending.h", which
            // itself includes "common.h") must only expand it once, or GLSL
            // rejects the duplicate function bodies (hsv2rgb, Desaturate, ...).
            const key = path ?? `std:${name}`;
            if (stack.has(key)) {
                return "";
            }
            stack.add(key);
            return this.#resolveIncludes(path ? (this.#readText(path) ?? "") : this.#standardInclude(name), stack);
        });
    }
    // Degraded fallback only: `SceneLoader` pre-fetches the real Wallpaper
    // Engine standard-library headers (common.h, common_blur.h, ...) from the
    // local Steam install into `#entries` before compilation runs, so
    // `#resolveIncludes` above resolves them as normal package entries and
    // this method is never reached for a properly resolved wallpaper. It is
    // only hit when neither the .pkg nor a local Wallpaper Engine install has
    // the header (no Steam install found, or a header this approximation
    // doesn't know about), and it reimplements a small, incomplete subset of
    // the real headers from memory - treat any shader that reaches this path
    // as a best-effort approximation, not a faithful port.
    #standardInclude(name) {
        if (name === "common.h") {
            return `
#define M_PI 3.14159265359
#define M_PI_HALF 1.57079632679
#define M_PI_2 6.28318530718
#define SQRT_2 1.41421356237
#define SQRT_3 1.73205080756
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 0.6666666667, 0.3333333333, 3.0);
  vec3 p = abs(frac(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv(vec3 c) {
  vec4 p = c.g < c.b ? vec4(c.bg, -1.0, 0.6666666667) : vec4(c.gb, 0.0, -0.3333333333);
  vec4 q = c.r < p.x ? vec4(p.xyw, c.r) : vec4(c.r, p.yzx);
  float d = q.x - min(q.w, q.y);
  return vec3(abs((q.w - q.y) / (6.0 * d + 1e-10) + q.z), d / (q.x + 1e-10), q.x);
}
vec2 rotateVec2(vec2 v, float r) {
  vec2 cs = vec2(cos(r), sin(r));
  return vec2(v.x * cs.x - v.y * cs.y, v.x * cs.y + v.y * cs.x);
}
float greyscale(vec3 color) { return dot(color, vec3(0.11, 0.59, 0.3)); }
vec4 Desaturate(vec3 color, float amount) {
  vec3 gray = vec3(dot(vec3(0.3, 0.59, 0.11), color));
  return vec4(mix(color, gray, amount), 1.0);
}
`;
        }
        if (name === "common_blending.h") {
            return `#include "common.h"
vec3 KomorebiRgbToHsl(vec3 c) {
  float low = min(min(c.r, c.g), c.b);
  float high = max(max(c.r, c.g), c.b);
  float delta = high - low;
  float lightness = (high + low) * 0.5;
  float saturation = delta == 0.0 ? 0.0 : delta / (1.0 - abs(2.0 * lightness - 1.0));
  float hue = 0.0;
  if (delta != 0.0) {
    if (high == c.r) hue = mod((c.g - c.b) / delta, 6.0);
    else if (high == c.g) hue = (c.b - c.r) / delta + 2.0;
    else hue = (c.r - c.g) / delta + 4.0;
    hue /= 6.0;
  }
  return vec3(hue, saturation, lightness);
}
float KomorebiHue(float p, float q, float t) {
  t = fract(t);
  if (t < 0.1666666667) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 0.6666666667) return p + (q - p) * (0.6666666667 - t) * 6.0;
  return p;
}
vec3 KomorebiHslToRgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(KomorebiHue(p, q, hsl.x + 0.3333333333), KomorebiHue(p, q, hsl.x), KomorebiHue(p, q, hsl.x - 0.3333333333));
}
vec3 ApplyBlending(const int mode, vec3 a, vec3 b, float opacity) {
  vec3 value = b;
  if (mode == 1) value = min(a, b);
  else if (mode == 2) value = a * b;
  else if (mode == 3) value = 1.0 - min((1.0 - a) / max(b, vec3(1e-6)), 1.0);
  else if (mode == 4 || mode == 20) value = max(a + b - 1.0, 0.0);
  else if (mode == 5) return min(a, b);
  else if (mode == 6) value = max(a, b);
  else if (mode == 7) value = 1.0 - (1.0 - a) * (1.0 - b);
  else if (mode == 8) value = min(a / max(1.0 - b, vec3(1e-6)), 1.0);
  else if (mode == 9) value = min(a + b, 1.0);
  else if (mode == 10) return max(a, b);
  else if (mode == 11) value = mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
  else if (mode == 12) value = mix(2.0 * a * b + a * a * (1.0 - 2.0 * b), sqrt(max(a, 0.0)) * (2.0 * b - 1.0) + 2.0 * a * (1.0 - b), step(0.5, b));
  else if (mode == 13) value = mix(2.0 * b * a, 1.0 - 2.0 * (1.0 - b) * (1.0 - a), step(0.5, b));
  else if (mode == 18) value = abs(a - b);
  else if (mode == 19) value = a + b - 2.0 * a * b;
  else if (mode == 24) value = (a + b) * 0.5;
  else if (mode == 25) value = 1.0 - abs(1.0 - a - b);
  else if (mode >= 26 && mode <= 29) {
    vec3 ah = KomorebiRgbToHsl(a);
    vec3 bh = KomorebiRgbToHsl(b);
    if (mode == 26) value = KomorebiHslToRgb(vec3(bh.x, ah.yz));
    else if (mode == 27) value = KomorebiHslToRgb(vec3(ah.x, bh.y, ah.z));
    else if (mode == 28) value = KomorebiHslToRgb(vec3(bh.xy, ah.z));
    else value = KomorebiHslToRgb(vec3(ah.xy, bh.z));
  } else if (mode == 30) value = vec3(max(a.r, max(a.g, a.b))) * b;
  else if (mode == 31) return a + b * opacity;
  else if (mode == 32) value = a + a * b;
  return mix(a, value, opacity);
}
`;
        }
        if (name === "common_composite.h") {
            return `#include "common_blending.h"
uniform float g_CompositeAlpha;
uniform vec2 g_CompositeOffset;
uniform vec3 g_CompositeColor;
vec2 ApplyCompositeOffset(vec2 uv, vec2 resolution) {
#if COMPOSITE != 0
  return uv + g_CompositeOffset / resolution;
#else
  return uv;
#endif
}
vec4 ApplyComposite(vec4 original, vec4 effect) {
#if COMPOSITEMONO == 1
  effect.rgb = vec3(greyscale(effect.rgb));
#endif
  effect.rgb *= g_CompositeColor;
#if COMPOSITE == 0
  return effect;
#elif COMPOSITE == 1
  effect.rgb = ApplyBlending(BLENDMODE, original.rgb, effect.rgb, effect.a * g_CompositeAlpha);
  effect.a = max(effect.a * saturate(g_CompositeAlpha), original.a);
#elif COMPOSITE == 2
  effect.a *= saturate(g_CompositeAlpha);
  effect = mix(effect, original, original.a);
#elif COMPOSITE == 3
  effect.a *= saturate(g_CompositeAlpha) * (1.0 - original.a);
#endif
  return effect;
}
`;
        }
        return "";
    }
    #readText(path) {
        if (path === undefined) {
            return null;
        }
        const bytes = this.#entries.get(path);
        if (!bytes) {
            return null;
        }
        // Some WE shader assets (observed in common_blur.h) use bare "\r"
        // (classic Mac) or "\r\n" line endings. Every other pass in this file
        // is line-based (split("\n")); a lone "\r" that split() doesn't
        // recognize glues two logical lines into one, which #hoistDeclarations
        // then moves around as a single broken unit. Normalizing at the single
        // point all shader text enters the pipeline avoids that everywhere.
        return this.#decoder.decode(bytes).replace(/\r\n?/g, "\n");
    }
}
