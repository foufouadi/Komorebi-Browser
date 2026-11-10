/*
 * Copyright (c) 2026 Foued Attar
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
// Wallpaper Engine shaders are HLSL-flavoured: they mix int and float freely, truncate a larger vector to a smaller operand, feed bools to arithmetic, take `%` of floats and write to varyings. GLSL ES rejects every one of those. This pass types the already-preprocessed source with a small tolerant parser and rewrites the offending expressions in place (inserting casts and swizzles) instead of guessing with regular expressions. Anything it cannot parse or type is left untouched.
const TOKEN = /([ \t\r\n]+)|(#[^\n]*)|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_]\w*)|(0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fF]?)|(<<=|>>=|<<|>>|<=|>=|==|!=|&&|\|\||\^\^|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|[-+*\/%<>=!~&|^?:;,.(){}[\]])/y;
const BUILTIN_TYPES = new Set([
    "void", "float", "int", "bool", "uint",
    "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4", "bvec2", "bvec3", "bvec4",
    "mat2", "mat3", "mat4", "sampler2D", "sampler3D", "samplerCube",
]);
const QUALIFIERS = new Set([
    "const", "in", "out", "inout", "uniform", "varying", "attribute",
    "highp", "mediump", "lowp", "flat", "smooth", "centroid",
]);
const ALIASES = {
    lerp: "mix", frac: "fract", saturate: "saturate", atan2: "atan", fmod: "mod",
    ddx: "dFdx", ddy: "dFdy", texture2D: "texture", texSample2D: "texture",
    texSample2DLod: "textureLod", CAST2: "vec2", CAST3: "vec3", CAST4: "vec4",
    CAST3X3: "mat3", float2: "vec2", float3: "vec3", float4: "vec4",
    int2: "ivec2", int3: "ivec3", int4: "ivec4",
};
const UNARY_FLOAT = new Set([
    "sin", "cos", "tan", "asin", "acos", "atan", "exp", "exp2", "log", "log2", "sqrt",
    "inversesqrt", "radians", "degrees", "floor", "ceil", "fract", "round", "trunc",
    "normalize", "saturate", "dFdx", "dFdy", "fwidth", "sinh", "cosh", "tanh",
]);
const UNARY_ANY = new Set(["abs", "sign"]);
// For each unifying built-in: the argument positions that may stay scalar next to a vector.
const GENERIC = {
    min: [1], max: [1], mod: [1], clamp: [1, 2], mix: [2], step: [0], smoothstep: [0, 1],
    pow: [], atan: [], distance: [], dot: [], cross: [], reflect: [], refract: [2],
};
const ASSIGN_OPS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="]);
const BINARY_LEVELS = [
    ["||"], ["^^"], ["&&"], ["|"], ["^"], ["&"], ["==", "!="], ["<", ">", "<=", ">="],
    ["<<", ">>"], ["+", "-"], ["*", "/", "%"],
];
const RESERVED = new Set([
    "sample", "input", "output", "filter", "packed", "common", "partition", "active",
    "smooth", "flat", "centroid", "patch", "resource", "precise", "attribute_",
]);
const SWIZZLE_SETS = ["xyzw", "rgba", "stpq"];
function vecOf(base, size) {
    if (size === 1) {
        return base;
    }
    return (base === "float" ? "vec" : base === "int" ? "ivec" : "bvec") + size;
}
function baseOf(type) {
    if (!type) {
        return null;
    }
    if (type === "float" || type === "int" || type === "bool") {
        return type;
    }
    if (/^vec\d$/.test(type) || /^mat\d$/.test(type)) {
        return "float";
    }
    if (/^ivec\d$/.test(type)) {
        return "int";
    }
    if (/^bvec\d$/.test(type)) {
        return "bool";
    }
    return null;
}
const isMat = (type) => Boolean(type && /^mat\d$/.test(type));
const isArray = (type) => Boolean(type && type.endsWith("[]"));
function sizeOf(type) {
    const match = type && /(\d)$/.exec(type);
    return match ? Number(match[1]) : baseOf(type) ? 1 : 0;
}
class Abort extends Error {
}
class Repair {
    #toks = [];
    #pos = 0;
    #edits = new Map();
    #scopes = [new Map()];
    #functions = new Map();
    #macros;
    #structs = new Set();
    #stage;
    #currentReturn = null;
    #inputUses = new Map();
    #mainBody = -1;
    #declTokens = new Set();
    #globalInits = [];
    constructor(source, stage, macros) {
        this.#stage = stage;
        this.#macros = macros;
        this.#tokenize(source);
    }
    run() {
        while (this.#pos < this.#toks.length) {
            this.#parseTopLevel();
        }
        return this.#emit();
    }
    #tokenize(source) {
        TOKEN.lastIndex = 0;
        let ws = "";
        while (TOKEN.lastIndex < source.length) {
            const match = TOKEN.exec(source);
            if (!match) {
                throw new Abort("lex");
            }
            if (match[1] !== undefined) {
                ws += match[1];
            }
            else if (match[3] !== undefined) {
                ws += /\n/.test(match[3]) ? "\n" : " ";
            }
            else if (match[2] !== undefined) {
                this.#toks.push({ k: "pp", s: match[2], ws });
                ws = "";
            }
            else {
                let text = match[4] ?? match[5] ?? match[6];
                const kind = match[4] !== undefined ? "id" : match[5] !== undefined ? "num" : "op";
                if (kind === "id" && RESERVED.has(text) && this.#toks.at(-1)?.s !== ".") {
                    text = `we_${text}`;
                }
                else if (text === "uint") {
                    // HLSL's uint is only ever mixed with floats and ints here; GLSL has no implicit conversion to it.
                    text = "int";
                }
                this.#toks.push({ k: kind, s: text, ws });
                ws = "";
            }
        }
    }
    #emit() {
        let out = "";
        const prelude = [];
        for (const [name, uses] of this.#inputUses) {
            if (!uses.written) {
                continue;
            }
            for (const index of uses.indices) {
                this.#edit(index).replace = `weLocal_${name}`;
            }
            prelude.push(`${uses.type} weLocal_${name};`);
            if (this.#mainBody >= 0) {
                this.#edit(this.#mainBody).after.push(` weLocal_${name} = ${name};`);
            }
        }
        if (this.#mainBody >= 0 && this.#globalInits.length) {
            this.#edit(this.#mainBody).after.push(...this.#globalInits);
        }
        // Right after the header's own precision statements, which the declarations depend on.
        let preludeAt = this.#toks.findIndex(token => token.k !== "pp");
        while (this.#toks[preludeAt]?.s === "precision") {
            while (this.#toks[preludeAt].s !== ";") {
                preludeAt++;
            }
            preludeAt++;
        }
        for (let index = 0; index < this.#toks.length; index++) {
            const token = this.#toks[index];
            const edit = this.#edits.get(index);
            if (index === preludeAt && prelude.length) {
                out += `\n${prelude.join("\n")}`;
            }
            out += token.ws;
            if (edit) {
                out += edit.before.join("") + (edit.replace ?? token.s) + edit.after.join("");
            }
            else {
                out += token.s;
            }
        }
        return out;
    }
    #edit(index) {
        let edit = this.#edits.get(index);
        if (!edit) {
            edit = { before: [], after: [], replace: undefined };
            this.#edits.set(index, edit);
        }
        return edit;
    }
    // Outer wraps are added after inner ones, so they go outside of them.
    #wrap(node, before, after) {
        this.#edit(node.start).before.unshift(before);
        this.#edit(node.end - 1).after.push(after);
    }
    #peek(offset = 0) {
        return this.#toks[this.#pos + offset];
    }
    #is(text, offset = 0) {
        const token = this.#toks[this.#pos + offset];
        return token !== undefined && token.k !== "pp" && token.s === text;
    }
    #next() {
        const token = this.#toks[this.#pos++];
        if (!token) {
            throw new Abort("eof");
        }
        return token;
    }
    #expect(text) {
        if (!this.#is(text)) {
            throw new Abort(`expected ${text}`);
        }
        this.#pos++;
    }
    #isType(name) {
        return BUILTIN_TYPES.has(name) || this.#structs.has(name);
    }
    #lookup(name) {
        for (let index = this.#scopes.length - 1; index >= 0; index--) {
            const symbol = this.#scopes[index].get(name);
            if (symbol) {
                return symbol;
            }
        }
        return null;
    }
    #declare(name, type, kind) {
        this.#scopes.at(-1).set(name, { type, kind });
    }
    #notePreprocessor(token) {
        const define = /^#\s*define\s+(\w+)\s+(.+?)\s*$/.exec(token.s);
        if (define) {
            const value = define[2].replace(/^\(\s*|\s*\)$/g, "");
            if (/^-?\d+$/.test(value)) {
                this.#macros.set(define[1], "int");
            }
            else if (/^-?(?:\d+\.\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) {
                this.#macros.set(define[1], "float");
            }
            else {
                this.#macros.delete(define[1]);
            }
        }
        const undef = /^#\s*undef\s+(\w+)/.exec(token.s);
        if (undef) {
            this.#macros.delete(undef[1]);
        }
    }
    // ---- declarations -------------------------------------------------
    #parseTopLevel() {
        const token = this.#peek();
        if (token.k === "pp") {
            this.#notePreprocessor(token);
            this.#pos++;
            return;
        }
        if (token.s === ";") {
            this.#pos++;
            return;
        }
        if (token.s === "precision") {
            while (!this.#is(";")) {
                this.#pos++;
            }
            this.#pos++;
            return;
        }
        if (token.s === "struct") {
            this.#pos++;
            const name = this.#next().s;
            this.#structs.add(name);
            this.#skipBraces();
            while (!this.#is(";")) {
                this.#pos++;
            }
            this.#pos++;
            return;
        }
        this.#parseDeclarationOrFunction(true);
    }
    #skipBraces() {
        this.#expect("{");
        let depth = 1;
        while (depth) {
            const token = this.#next();
            if (token.k === "pp") {
                continue;
            }
            if (token.s === "{") {
                depth++;
            }
            else if (token.s === "}") {
                depth--;
            }
        }
    }
    #readQualifiers() {
        const qualifiers = new Set();
        let constIndex = -1;
        while (this.#peek() && this.#peek().k === "id" && (QUALIFIERS.has(this.#peek().s) || this.#peek().s === "layout")) {
            if (this.#peek().s === "layout") {
                this.#pos++;
                this.#expect("(");
                while (!this.#is(")")) {
                    this.#pos++;
                }
            }
            else if (this.#peek().s === "const") {
                constIndex = this.#pos;
            }
            qualifiers.add(this.#peek().s);
            this.#pos++;
        }
        return { qualifiers, constIndex };
    }
    #startsDeclaration() {
        let offset = 0;
        while (this.#peek(offset)?.k === "id" && QUALIFIERS.has(this.#peek(offset).s)) {
            offset++;
        }
        const type = this.#peek(offset);
        if (type?.k !== "id" || !this.#isType(type.s)) {
            return false;
        }
        return offset > 0 || this.#peek(offset + 1)?.k === "id";
    }
    #parseDeclarationOrFunction(topLevel) {
        const { qualifiers, constIndex } = this.#readQualifiers();
        const typeToken = this.#next();
        if (typeToken.k !== "id" || !this.#isType(typeToken.s)) {
            throw new Abort("type");
        }
        let type = typeToken.s;
        if (this.#is("[")) {
            this.#pos++;
            while (!this.#is("]")) {
                this.#pos++;
            }
            this.#pos++;
            type += "[]";
        }
        const nameToken = this.#next();
        if (nameToken.k !== "id") {
            throw new Abort("name");
        }
        if (this.#is("(") && topLevel) {
            this.#parseFunction(type, nameToken.s);
            return;
        }
        const kind = qualifiers.has("uniform") ? "uniform"
            : qualifiers.has("varying") || qualifiers.has("in") && this.#stage === "frag" ? "varying"
                : qualifiers.has("attribute") || qualifiers.has("in") ? "attribute"
                    : qualifiers.has("const") ? "const" : "var";
        this.#pos--;
        this.#parseDeclarators(type, kind, constIndex, topLevel);
        this.#expect(";");
    }
    #parseDeclarators(type, kind, constIndex, topLevel) {
        for (;;) {
            const nameIndex = this.#pos;
            const name = this.#next().s;
            let declared = type;
            let isArrayDeclarator = isArray(type);
            if (this.#is("[")) {
                this.#pos++;
                if (!this.#is("]")) {
                    this.#parseAssign();
                }
                this.#expect("]");
                declared = `${type}[]`;
                isArrayDeclarator = true;
            }
            let init = null;
            if (this.#is("=")) {
                this.#pos++;
                init = this.#parseAssign();
                if (isArrayDeclarator) {
                    this.#unwrapArrayConstructor(init, type.replace("[]", ""));
                }
                else {
                    this.#coerce(init, type);
                }
            }
            let effectiveKind = kind;
            if (kind === "const" && constIndex >= 0 && init && init.nonConst && !isArrayDeclarator) {
                this.#edit(constIndex).replace = "";
                effectiveKind = "var";
            }
            if (kind === "const" && !init) {
                effectiveKind = "var";
            }
            if (topLevel && effectiveKind === "var" && init && init.nonConst && !isArrayDeclarator) {
                this.#hoistGlobalInitializer(name, init);
            }
            this.#declare(name, declared, effectiveKind);
            if (kind === "varying" || kind === "attribute") {
                this.#declTokens.add(nameIndex);
            }
            if (this.#is(",")) {
                this.#pos++;
                continue;
            }
            return;
        }
    }
    // GLSL ES 3.00 only accepts constant global initializers; HLSL evaluates them at start-up, which is main()'s first statement here.
    #hoistGlobalInitializer(name, init) {
        this.#globalInits.push(` ${name} = ${this.#render(init.start, init.end)};`);
        for (let index = init.start - 1; index < init.end; index++) {
            this.#edits.delete(index);
            this.#edit(index).replace = "";
        }
    }
    #render(from, to) {
        let out = "";
        for (let index = from; index < to; index++) {
            const edit = this.#edits.get(index);
            const token = this.#toks[index];
            out += (index > from ? token.ws : "") + (edit ? edit.before.join("") + (edit.replace ?? token.s) + edit.after.join("") : token.s);
        }
        return out;
    }
    // `const vec2 k[N] = vec2(vec2[N](...))`: the author wrapped an array constructor in a scalar one, which only HLSL tolerates.
    #unwrapArrayConstructor(init, element) {
        if (init.kind === "call" && init.name === element && init.args.length === 1 &&
            isArray(init.args[0].type)) {
            this.#edit(init.start).replace = "";
            this.#edit(init.start + 1).replace = "";
            this.#edit(init.end - 1).replace = "";
        }
    }
    #parseFunction(returnType, name) {
        this.#expect("(");
        const params = [];
        this.#scopes.push(new Map());
        while (!this.#is(")")) {
            const { qualifiers } = this.#readQualifiers();
            const typeName = this.#next().s;
            if (typeName === "void" && this.#is(")")) {
                break;
            }
            let type = typeName;
            let pname = null;
            if (this.#peek().k === "id") {
                pname = this.#next().s;
            }
            if (this.#is("[")) {
                while (!this.#is("]")) {
                    this.#pos++;
                }
                this.#pos++;
                type += "[]";
            }
            params.push({ type, out: qualifiers.has("out") || qualifiers.has("inout") });
            if (pname) {
                this.#declare(pname, type, "param");
            }
            if (this.#is(",")) {
                this.#pos++;
            }
        }
        this.#expect(")");
        const list = this.#functions.get(name) ?? [];
        const signature = { ret: returnType, params };
        list.push(signature);
        this.#functions.set(name, list);
        if (this.#is(";")) {
            this.#pos++;
            this.#scopes.pop();
            return;
        }
        if (name === "main") {
            this.#mainBody = this.#pos;
        }
        const previous = this.#currentReturn;
        this.#currentReturn = returnType;
        this.#parseBlock(false);
        this.#currentReturn = previous;
        this.#scopes.pop();
    }
    // ---- statements ---------------------------------------------------
    #parseBlock(scoped = true) {
        this.#expect("{");
        if (scoped) {
            this.#scopes.push(new Map());
        }
        while (!this.#is("}")) {
            this.#parseStatement();
        }
        this.#pos++;
        if (scoped) {
            this.#scopes.pop();
        }
    }
    #parseStatement() {
        const token = this.#peek();
        if (!token) {
            throw new Abort("eof");
        }
        if (token.k === "pp") {
            this.#notePreprocessor(token);
            this.#pos++;
            return;
        }
        switch (token.s) {
            case "{":
                this.#parseBlock();
                return;
            case ";":
                this.#pos++;
                return;
            case "if": {
                this.#pos++;
                this.#expect("(");
                this.#coerceBool(this.#parseExpression());
                this.#expect(")");
                this.#parseScopedStatement();
                if (this.#is("else")) {
                    this.#pos++;
                    this.#parseScopedStatement();
                }
                return;
            }
            case "while": {
                this.#pos++;
                this.#expect("(");
                this.#coerceBool(this.#parseExpression());
                this.#expect(")");
                this.#parseScopedStatement();
                return;
            }
            case "do": {
                this.#pos++;
                this.#parseScopedStatement();
                this.#expect("while");
                this.#expect("(");
                this.#coerceBool(this.#parseExpression());
                this.#expect(")");
                this.#expect(";");
                return;
            }
            case "for": {
                this.#pos++;
                this.#expect("(");
                this.#scopes.push(new Map());
                if (!this.#is(";")) {
                    if (this.#startsDeclaration()) {
                        this.#parseDeclarationOrFunction(false);
                    }
                    else {
                        this.#parseExpression();
                        this.#expect(";");
                    }
                }
                else {
                    this.#pos++;
                }
                if (!this.#is(";")) {
                    this.#coerceBool(this.#parseExpression());
                }
                this.#expect(";");
                if (!this.#is(")")) {
                    this.#parseExpression();
                }
                this.#expect(")");
                this.#parseScopedStatement();
                this.#scopes.pop();
                return;
            }
            case "return": {
                this.#pos++;
                if (!this.#is(";")) {
                    const value = this.#parseExpression();
                    if (this.#currentReturn && this.#currentReturn !== "void") {
                        this.#coerce(value, this.#currentReturn);
                    }
                }
                this.#expect(";");
                return;
            }
            case "break":
            case "continue":
            case "discard":
                this.#pos++;
                this.#expect(";");
                return;
            default:
        }
        if (this.#startsDeclaration()) {
            this.#parseDeclarationOrFunction(false);
            return;
        }
        this.#parseExpression();
        this.#expect(";");
    }
    #parseScopedStatement() {
        this.#scopes.push(new Map());
        this.#parseStatement();
        this.#scopes.pop();
    }
    // ---- expressions --------------------------------------------------
    #parseExpression() {
        let node = this.#parseAssign();
        while (this.#is(",")) {
            this.#pos++;
            const right = this.#parseAssign();
            node = { kind: "comma", type: right.type, start: node.start, end: right.end, nonConst: true };
        }
        return node;
    }
    #parseAssign() {
        const left = this.#parseTernary();
        const token = this.#peek();
        if (token && token.k === "op" && ASSIGN_OPS.has(token.s)) {
            this.#pos++;
            const right = this.#parseAssign();
            this.#applyAssign(token.s, left, right);
            return { kind: "assign", type: left.type, start: left.start, end: right.end, nonConst: true };
        }
        return left;
    }
    #markWritten(node) {
        let current = node;
        while (current && (current.kind === "member" || current.kind === "index")) {
            current = current.base;
        }
        if (current?.kind === "ident" && current.input) {
            const uses = this.#inputUses.get(current.name);
            if (uses) {
                uses.written = true;
            }
        }
    }
    #applyAssign(operator, left, right) {
        this.#markWritten(left);
        if (operator === "=") {
            this.#coerce(right, left.type);
            return;
        }
        const leftType = left.type;
        if (operator === "%=" || !leftType) {
            return;
        }
        if (right.type === "bool") {
            this.#toBase(right, "float");
        }
        if (baseOf(leftType) === "float" && baseOf(right.type) === "int") {
            this.#toBase(right, "float");
        }
        else if (baseOf(leftType) === "int" && baseOf(right.type) === "float") {
            this.#toBase(right, "int");
        }
        if (!isMat(leftType) && !isMat(right.type) && sizeOf(right.type) > sizeOf(leftType)) {
            this.#truncate(right, sizeOf(leftType));
        }
    }
    #parseTernary() {
        const condition = this.#parseBinary(0);
        if (!this.#is("?")) {
            return condition;
        }
        this.#pos++;
        this.#coerceBool(condition);
        const yes = this.#parseAssign();
        this.#expect(":");
        const no = this.#parseAssign();
        this.#unify([yes, no]);
        return {
            kind: "ternary", type: yes.type === no.type ? yes.type : yes.type ?? no.type,
            start: condition.start, end: no.end, nonConst: condition.nonConst || yes.nonConst || no.nonConst,
        };
    }
    #parseBinary(level) {
        if (level >= BINARY_LEVELS.length) {
            return this.#parseUnary();
        }
        let left = this.#parseBinary(level + 1);
        for (;;) {
            const token = this.#peek();
            if (!token || token.k !== "op" || !BINARY_LEVELS[level].includes(token.s)) {
                return left;
            }
            const operatorIndex = this.#pos++;
            const right = this.#parseBinary(level + 1);
            left = this.#makeBinary(token.s, operatorIndex, left, right);
        }
    }
    #makeBinary(operator, operatorIndex, left, right) {
        let type = null;
        if (operator === "&&" || operator === "||" || operator === "^^") {
            this.#coerceBool(left);
            this.#coerceBool(right);
            type = "bool";
        }
        else if (["==", "!=", "<", ">", "<=", ">="].includes(operator)) {
            this.#unifyNumeric(left, right);
            type = "bool";
        }
        else if (operator === "%") {
            const integral = baseOf(left.type) === "int" && baseOf(right.type) === "int";
            if (!integral && left.type && right.type) {
                this.#unifyNumeric(left, right);
                // GLSL has no float `%`; HLSL's behaves like mod() for the positive values these shaders use.
                this.#edit(left.start).before.unshift("mod(");
                this.#edit(operatorIndex).replace = ",";
                this.#edit(right.end - 1).after.push(")");
                type = left.type;
            }
            else {
                type = left.type;
            }
        }
        else if (["+", "-", "*", "/"].includes(operator)) {
            type = this.#arithmetic(operator, left, right);
        }
        else {
            type = left.type;
        }
        return {
            kind: "binary", type, start: left.start, end: right.end,
            nonConst: left.nonConst || right.nonConst,
        };
    }
    #arithmetic(operator, left, right) {
        if (left.type === "bool") {
            this.#toBase(left, "float");
        }
        if (right.type === "bool") {
            this.#toBase(right, "float");
        }
        const leftType = left.type;
        const rightType = right.type;
        if (!leftType || !rightType) {
            return null;
        }
        if (isMat(leftType) || isMat(rightType)) {
            if (isMat(leftType) && isMat(rightType)) {
                return leftType;
            }
            const matrix = isMat(leftType) ? leftType : rightType;
            const other = isMat(leftType) ? rightType : leftType;
            return sizeOf(other) > 1 ? other : matrix;
        }
        this.#unifyNumeric(left, right);
        const leftSize = sizeOf(left.type);
        const rightSize = sizeOf(right.type);
        const base = baseOf(left.type) ?? "float";
        return vecOf(base, Math.max(leftSize, rightSize));
    }
    // Converts an int operand next to a float one and truncates the larger of two vectors (both HLSL implicit conversions).
    #unifyNumeric(left, right) {
        if (!left.type || !right.type || isMat(left.type) || isMat(right.type)) {
            return;
        }
        const leftBase = baseOf(left.type);
        const rightBase = baseOf(right.type);
        if (leftBase === "bool" || rightBase === "bool") {
            return;
        }
        if (leftBase === "int" && rightBase === "float") {
            this.#toBase(left, "float");
        }
        else if (leftBase === "float" && rightBase === "int") {
            this.#toBase(right, "float");
        }
        const leftSize = sizeOf(left.type);
        const rightSize = sizeOf(right.type);
        if (leftSize > 1 && rightSize > 1 && leftSize !== rightSize) {
            if (leftSize > rightSize) {
                this.#truncate(left, rightSize);
            }
            else {
                this.#truncate(right, leftSize);
            }
        }
    }
    #unify(nodes) {
        for (let index = 1; index < nodes.length; index++) {
            this.#unifyNumeric(nodes[0], nodes[index]);
        }
        if (nodes.length === 2) {
            this.#unifyNumeric(nodes[1], nodes[0]);
        }
    }
    #parseUnary() {
        const token = this.#peek();
        if (token && token.k === "op" && ["-", "+", "!", "~", "++", "--"].includes(token.s)) {
            const start = this.#pos++;
            const operand = this.#parseUnary();
            let type = operand.type;
            if (token.s === "!") {
                this.#coerceBool(operand);
                type = "bool";
            }
            if (token.s === "++" || token.s === "--") {
                this.#markWritten(operand);
            }
            return { kind: "unary", type, start, end: operand.end, nonConst: operand.nonConst || token.s === "++" || token.s === "--" };
        }
        return this.#parsePostfix();
    }
    #parsePostfix() {
        let node = this.#parsePrimary();
        for (;;) {
            if (this.#is("[")) {
                this.#pos++;
                const index = this.#parseExpression();
                this.#expect("]");
                if (index.type === "float") {
                    this.#toBase(index, "int");
                }
                const type = node.type;
                const element = isArray(type) ? type.slice(0, -2)
                    : isMat(type) ? vecOf("float", sizeOf(type))
                        : sizeOf(type) > 1 ? baseOf(type) : null;
                node = { kind: "index", type: element, base: node, start: node.start, end: this.#pos, nonConst: node.nonConst || index.nonConst };
            }
            else if (this.#is(".")) {
                this.#pos++;
                const member = this.#next();
                if (this.#is("(") && member.s === "length") {
                    this.#pos++;
                    this.#expect(")");
                    node = { kind: "call", type: "int", start: node.start, end: this.#pos, nonConst: node.nonConst, args: [], name: "length" };
                    continue;
                }
                let type = null;
                const baseType = node.type;
                if (baseType && /^[ib]?vec\d$/.test(baseType) && /^[xyzwrgbastpq]{1,4}$/.test(member.s)) {
                    type = vecOf(baseOf(baseType), member.s.length);
                }
                else if ((baseType === "float" || baseType === "int") && /^(?:x{1,4}|r{1,4}|s{1,4})$/.test(member.s)) {
                    // HLSL allows swizzling a scalar (`dot(a, b).x`, `v.xxx`): it broadcasts.
                    this.#edit(this.#pos - 2).replace = "";
                    this.#edit(this.#pos - 1).replace = "";
                    if (member.s.length > 1) {
                        this.#wrap(node, `${vecOf(baseType, member.s.length)}(`, ")");
                    }
                    type = vecOf(baseType, member.s.length);
                }
                node ={ kind: "member", type, base: node, start: node.start, end: this.#pos, nonConst: node.nonConst };
            }
            else if (this.#is("++") || this.#is("--")) {
                this.#markWritten(node);
                this.#pos++;
                node = { kind: "postfix", type: node.type, start: node.start, end: this.#pos, nonConst: true };
            }
            else {
                return node;
            }
        }
    }
    #parsePrimary() {
        const token = this.#next();
        const start = this.#pos - 1;
        if (token.k === "num") {
            const isFloat = /^0[xX]/.test(token.s) ? false : /[.eE]/.test(token.s) || /[fF]$/.test(token.s);
            return { kind: "num", type: isFloat ? "float" : "int", start, end: this.#pos, nonConst: false, token };
        }
        if (token.s === "(") {
            const inner = this.#parseExpression();
            this.#expect(")");
            return { kind: "paren", type: inner.type, start, end: this.#pos, nonConst: inner.nonConst };
        }
        if (token.k !== "id") {
            throw new Abort(`unexpected ${token.s}`);
        }
        if (token.s === "true" || token.s === "false") {
            return { kind: "num", type: "bool", start, end: this.#pos, nonConst: false, token };
        }
        if (this.#is("[") && this.#isType(token.s)) {
            this.#pos++;
            while (!this.#is("]")) {
                this.#pos++;
            }
            this.#pos++;
            return this.#parseCall(token.s, start, `${token.s}[]`);
        }
        if (this.#is("(")) {
            return this.#parseCall(token.s, start, null);
        }
        const symbol = this.#lookup(token.s);
        if (symbol) {
            const input = (symbol.kind === "varying" && this.#stage === "frag") ||
                (symbol.kind === "attribute" && this.#stage === "vert");
            if (input) {
                let uses = this.#inputUses.get(token.s);
                if (!uses) {
                    uses = { indices: [], written: false, type: symbol.type };
                    this.#inputUses.set(token.s, uses);
                }
                if (!this.#declTokens.has(start)) {
                    uses.indices.push(start);
                }
            }
            return {
                kind: "ident", type: symbol.type, start, end: this.#pos, name: token.s, input,
                nonConst: symbol.kind !== "const",
            };
        }
        return { kind: "ident", type: this.#macros.get(token.s) ?? null, start, end: this.#pos, name: token.s, nonConst: false };
    }
    #parseCall(name, start, arrayType) {
        this.#expect("(");
        const args = [];
        while (!this.#is(")")) {
            args.push(this.#parseAssign());
            if (this.#is(",")) {
                this.#pos++;
            }
        }
        this.#pos++;
        const node = {
            kind: "call", name, args, start, end: this.#pos, type: null,
            nonConst: args.some(arg => arg.nonConst) || this.#functions.has(name),
        };
        node.type = arrayType ?? this.#typeCall(name, args, node);
        return node;
    }
    #typeCall(rawName, args, node) {
        const name = ALIASES[rawName] ?? rawName;
        if (this.#isType(name)) {
            return name;
        }
        const overloads = this.#functions.get(rawName);
        if (overloads) {
            const matching = overloads.filter(signature => signature.params.length === args.length);
            if (matching.length === 1) {
                matching[0].params.forEach((param, index) => {
                    if (!param.out) {
                        this.#coerce(args[index], param.type);
                    }
                });
            }
            return matching[0]?.ret ?? null;
        }
        if (rawName === "mul" && args.length === 2) {
            return this.#arithmeticType(args[1], args[0]);
        }
        if (name === "texture" || name === "textureLod" || name === "texelFetch") {
            const sampler = args[0]?.type;
            if (name !== "texelFetch" && args[1] && /^vec[34]$/.test(args[1].type ?? "")) {
                const wanted = sampler === "sampler2D" ? 2 : 3;
                if (sizeOf(args[1].type) > wanted) {
                    this.#truncate(args[1], wanted);
                }
            }
            if (name === "textureLod" && args[2]) {
                this.#toBase(args[2], "float");
            }
            return "vec4";
        }
        if (UNARY_FLOAT.has(name) && args.length === 1) {
            if (baseOf(args[0].type) === "int") {
                this.#toBase(args[0], "float");
            }
            return args[0].type;
        }
        if (UNARY_ANY.has(name) && args.length === 1) {
            return args[0].type;
        }
        if (name === "length" && args.length === 1) {
            if (baseOf(args[0].type) === "int") {
                this.#toBase(args[0], "float");
            }
            return "float";
        }
        if (name === "all" || name === "any") {
            return "bool";
        }
        if (name === "transpose" || name === "inverse") {
            return args[0]?.type ?? null;
        }
        if (name === "determinant") {
            return "float";
        }
        if (name === "normalize") {
            return args[0]?.type ?? null;
        }
        const scalarPositions = GENERIC[name];
        if (scalarPositions && args.length >= 2) {
            return this.#typeGeneric(name, args, scalarPositions);
        }
        void node;
        return null;
    }
    #arithmeticType(left, right) {
        const leftType = left.type;
        const rightType = right.type;
        if (!leftType || !rightType) {
            return null;
        }
        if (isMat(leftType) || isMat(rightType)) {
            const other = isMat(leftType) ? rightType : leftType;
            return sizeOf(other) > 1 && !isMat(other) ? other : isMat(leftType) ? leftType : rightType;
        }
        return vecOf(baseOf(leftType) ?? "float", Math.max(sizeOf(leftType), sizeOf(rightType)));
    }
    // Brings the arguments of a component-wise built-in to one base type and one vector size.
    #typeGeneric(name, args, scalarPositions) {
        const reducing = name === "dot" || name === "distance";
        if (args.some(arg => !arg.type || isMat(arg.type) || baseOf(arg.type) === "bool")) {
            return reducing ? "float" : args[0].type ?? null;
        }
        const allInt = args.every(arg => baseOf(arg.type) === "int");
        if (!allInt) {
            for (const arg of args) {
                if (baseOf(arg.type) === "int") {
                    this.#toBase(arg, "float");
                }
            }
        }
        let size = 1;
        for (const arg of args) {
            const argSize = sizeOf(arg.type);
            if (argSize > 1 && (size === 1 || argSize < size)) {
                size = argSize;
            }
        }
        args.forEach((arg, index) => {
            const argSize = sizeOf(arg.type);
            if (size > 1 && argSize > size) {
                this.#truncate(arg, size);
            }
            else if (size > 1 && argSize === 1 && !reducing && !scalarPositions.includes(index)) {
                this.#wrap(arg, `${vecOf(baseOf(arg.type), size)}(`, ")");
                arg.type = vecOf(baseOf(arg.type), size);
            }
        });
        if (reducing) {
            return "float";
        }
        const base = allInt ? "int" : "float";
        const type = vecOf(base, size);
        return name === "step" ? vecOf(base, Math.max(size, 1)) : type;
    }
    // ---- conversions --------------------------------------------------
    #toBase(node, base) {
        const type = node.type;
        if (!type || baseOf(type) === base || isMat(type)) {
            return;
        }
        const size = sizeOf(type);
        const target = vecOf(base, size);
        if (node.kind === "num" && base === "float" && type === "int" && /^\d+$/.test(node.token.s)) {
            this.#edit(node.start).replace = `${node.token.s}.0`;
        }
        else {
            this.#wrap(node, `${target}(`, ")");
        }
        node.type = target;
    }
    #truncate(node, size) {
        const type = node.type;
        if (!type || sizeOf(type) <= size || isMat(type)) {
            return;
        }
        const swizzle = SWIZZLE_SETS[0].slice(0, size);
        if (["ident", "call", "index", "member", "paren"].includes(node.kind)) {
            this.#edit(node.end - 1).after.push(`.${swizzle}`);
        }
        else {
            this.#wrap(node, "(", `).${swizzle}`);
        }
        node.type = vecOf(baseOf(type), size);
    }
    #coerceBool(node) {
        const type = node.type;
        if (!type || type === "bool" || isMat(type) || isArray(type)) {
            return;
        }
        const base = baseOf(type);
        if (!base) {
            return;
        }
        this.#wrap(node, "(", ` != ${base === "int" ? "0" : "0.0"})`);
        node.type = "bool";
    }
    // Implicit conversion of `node` to `to` the way an HLSL assignment would do it.
    #coerce(node, to) {
        const from = node.type;
        if (!from || !to || from === to || isArray(from) || isArray(to) || isMat(from) || isMat(to)) {
            return;
        }
        const toBase = baseOf(to);
        const fromBase = baseOf(from);
        if (!toBase || !fromBase) {
            return;
        }
        if (toBase === "bool") {
            if (fromBase !== "bool") {
                this.#coerceBool(node);
            }
            return;
        }
        const toSize = sizeOf(to);
        const fromSize = sizeOf(from);
        if (fromSize > toSize) {
            this.#truncate(node, toSize);
        }
        if (baseOf(node.type) !== toBase) {
            this.#toBase(node, toBase);
        }
        if (sizeOf(node.type) === 1 && toSize > 1) {
            this.#wrap(node, `${to}(`, ")");
            node.type = to;
        }
        else if (sizeOf(node.type) > 1 && sizeOf(node.type) < toSize) {
            // A varying promoted by reconcileVaryings: the extra components are padding.
            this.#wrap(node, `${to}(`, `${", 0.0".repeat(toSize - sizeOf(node.type))})`);
            node.type = to;
        }
    }
}
/**
 * Rewrites the HLSL-style implicit conversions in a preprocessed shader body. Returns the source unchanged when it cannot be parsed.
 */
export function repairShaderTypes(source, stage) {
    try {
        return new Repair(source, stage, new Map()).run();
    }
    catch (error) {
        if (error instanceof Abort) {
            return source;
        }
        throw error;
    }
}
