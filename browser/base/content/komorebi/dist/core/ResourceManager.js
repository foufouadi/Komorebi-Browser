export class ResourceManager {
    #gl;
    constructor(gl) {
        this.#gl = gl;
    }
    releaseLayers(layers) {
        const gl = this.#gl;
        for (const layer of layers) {
            const releasedTextures = new Set([layer.glTexture]);
            this.#releaseMedia(layer);
            gl.deleteTexture(layer.glTexture);
            if (layer.puppetPositionBuffer)
                gl.deleteBuffer(layer.puppetPositionBuffer);
            if (layer.puppetEffectPositionBuffer)
                gl.deleteBuffer(layer.puppetEffectPositionBuffer);
            if (layer.puppetTexCoordBuffer)
                gl.deleteBuffer(layer.puppetTexCoordBuffer);
            if (layer.puppetIndexBuffer)
                gl.deleteBuffer(layer.puppetIndexBuffer);
            for (const pass of layer.renderPasses) {
                // pass.program is not deleted here: it is owned by GraphicsContext's
                // ProgramCache (shared across layers/passes by shader source) and is
                // released once, engine-wide, from GraphicsContext.dispose().
                if (pass.outputTexture)
                    gl.deleteTexture(pass.outputTexture);
                if (pass.framebuffer)
                    gl.deleteFramebuffer(pass.framebuffer);
                for (const texture of pass.resolvedTextures?.values() || []) {
                    if (releasedTextures.has(texture.glTexture)) {
                        continue;
                    }
                    releasedTextures.add(texture.glTexture);
                    this.#releaseMedia(texture);
                    gl.deleteTexture(texture.glTexture);
                }
            }
        }
    }
    releaseParticles(particles) {
        const gl = this.#gl;
        for (const particle of particles) {
            this.#releaseMedia(particle);
            gl.deleteTexture(particle.glTexture);
        }
    }
    #releaseMedia(texture) {
        if (texture.video) {
            texture.video.pause();
            texture.video.removeAttribute("src");
            texture.video.load();
        }
        if (texture.objectURL) {
            URL.revokeObjectURL(texture.objectURL);
        }
    }
}
