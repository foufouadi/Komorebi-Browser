import { FULLSCREEN_VERTICES, FULLSCREEN_UVS } from "./Geometry.js";
import { createStaticBuffer } from "../BufferUtils.js";
export class ScreenQuad {
    positionBuffer;
    texCoordBuffer;
    constructor(gl) {
        this.positionBuffer = createStaticBuffer(gl, FULLSCREEN_VERTICES);
        this.texCoordBuffer = createStaticBuffer(gl, FULLSCREEN_UVS);
    }
}
