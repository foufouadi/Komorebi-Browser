import { QUAD_VERTICES } from "./Geometry.js";
import { createStaticBuffer } from "../BufferUtils.js";
export class LayerQuad {
    positionBuffer;
    constructor(gl) {
        this.positionBuffer = createStaticBuffer(gl, QUAD_VERTICES);
    }
}
