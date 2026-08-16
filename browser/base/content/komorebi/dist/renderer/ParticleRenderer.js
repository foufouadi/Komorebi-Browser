import { PARTICLE_FRAGMENT_SHADER } from "../graphics/shaders/ParticleFragmentShader.js";
import { PARTICLE_VERTEX_SHADER } from "../graphics/shaders/ParticleVertexShader.js";
export class ParticleRenderer {
    #gl;
    #program;
    #buffers;
    #states = new WeakMap();
    constructor(graphics) {
        this.#gl = graphics.gl;
        this.#program = graphics.programs.get(PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER);
        this.#buffers = Array.from({ length: 4 }, () => {
            const buffer = this.#gl.createBuffer();
            if (!buffer)
                throw new Error("Failed to create WebGL buffer");
            return buffer;
        });
    }
    draw(systems, context) {
        const gl = this.#gl;
        gl.useProgram(this.#program);
        gl.uniform2f(gl.getUniformLocation(this.#program, "uProjection"), context.projection[0], context.projection[1]);
        gl.uniform2f(gl.getUniformLocation(this.#program, "uSceneScale"), context.sceneScale[0], context.sceneScale[1]);
        gl.uniform1f(gl.getUniformLocation(this.#program, "uPixelScale"), (context.height / context.projection[1]) * context.sceneScale[1]);
        for (const system of systems) {
            const state = this.#state(system, context.timestamp);
            const dt = Math.min(0.1, Math.max(0, (context.timestamp - state.lastTimestamp) / 1000));
            state.lastTimestamp = context.timestamp;
            if (dt > 0)
                this.#update(system, state, dt);
            if (!state.instances.length)
                continue;
            const data = this.#vertices(system, state.instances);
            this.#upload("aParticle", 4, this.#buffers[0], data.particles);
            this.#upload("aParticleColor", 3, this.#buffers[1], data.colors);
            this.#upload("aParticleRotation", 1, this.#buffers[2], data.rotations);
            this.#upload("aParticleTexRect", 4, this.#buffers[3], data.textureRects);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, system.glTexture);
            gl.uniform1i(gl.getUniformLocation(this.#program, "uTexture"), 0);
            if (system.blending === "additive") {
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.SRC_ALPHA, gl.ONE);
            }
            else if (system.blending === "translucent") {
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            }
            else {
                gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ZERO);
            }
            gl.drawArrays(gl.POINTS, 0, state.instances.length);
        }
    }
    #state(system, timestamp) {
        let state = this.#states.get(system);
        if (!state) {
            state = {
                emitters: system.emitters.map(emitter => ({
                    delay: emitter.delay,
                    duration: 0,
                    emission: 0,
                    emittedInstantaneous: false,
                    emitting: false,
                    periodicDelay: 0,
                    periodicDuration: 0,
                    periodicTime: 0,
                })),
                instances: [],
                lastTimestamp: timestamp,
            };
            this.#states.set(system, state);
        }
        return state;
    }
    #update(system, state, dt) {
        system.emitters.forEach((emitter, index) => this.#emit(system, state, emitter, state.emitters[index], dt));
        for (const particle of state.instances)
            particle.age += dt;
        for (const particle of state.instances) {
            particle.position[0] += particle.velocity[0] * dt;
            particle.position[1] += particle.velocity[1] * dt;
            particle.velocity[0] += system.gravity[0] * dt * system.speed;
            particle.velocity[1] -= system.gravity[1] * dt * system.speed;
            const drag = Math.max(0, 1 - system.movementDrag * dt);
            particle.velocity[0] *= drag;
            particle.velocity[1] *= drag;
            particle.rotation += particle.angularVelocity * dt * system.speed;
            particle.angularVelocity += system.angularForce[2] * dt * system.speed;
            particle.angularVelocity *= Math.max(0, 1 - system.angularDrag * dt);
            particle.rotation =
                ((particle.rotation + Math.PI) % (Math.PI * 2)) - Math.PI;
            const life = particle.age / particle.lifetime;
            particle.alpha =
                this.#fade(life, system.fadeIn, system.fadeOut) * particle.initialAlpha;
            this.#frame(system, particle, life);
        }
        state.instances = state.instances.filter(particle => particle.age < particle.lifetime);
    }
    #emit(system, state, emitter, runtime, dt) {
        if (state.instances.length >= system.count)
            return;
        if (runtime.delay > 0) {
            runtime.delay -= dt;
            return;
        }
        if (emitter.duration > 0 && (runtime.duration += dt) >= emitter.duration)
            return;
        if (emitter.flags & 4) {
            runtime.periodicTime += dt;
            if (!runtime.emitting) {
                if (runtime.periodicTime < runtime.periodicDelay)
                    return;
                runtime.emitting = true;
                runtime.periodicTime = 0;
                runtime.periodicDuration = this.#range([
                    emitter.minPeriodicDuration,
                    emitter.maxPeriodicDuration,
                ]);
            }
            else if (runtime.periodicTime >= runtime.periodicDuration) {
                runtime.emitting = false;
                runtime.periodicTime = 0;
                runtime.periodicDelay = this.#range([
                    emitter.minPeriodicDelay,
                    emitter.maxPeriodicDelay,
                ]);
                return;
            }
        }
        let count = 0;
        if (emitter.instantaneous && !runtime.emittedInstantaneous) {
            count = emitter.instantaneous;
            runtime.emittedInstantaneous = true;
        }
        else {
            runtime.emission += dt * emitter.rate;
            count = Math.floor(runtime.emission);
            runtime.emission -= count;
        }
        if (emitter.flags & 2)
            count = Math.min(1, count);
        count = Math.min(count, system.count - state.instances.length);
        for (let index = 0; index < count; index++)
            state.instances.push(this.#spawn(system, emitter));
    }
    #spawn(system, emitter) {
        const offset = this.#offset(emitter);
        const position = [
            emitter.origin[0] + offset[0],
            -emitter.origin[1] + offset[1],
            offset[2],
        ];
        const emitterSpeed = this.#range(emitter.speed);
        const distance = Math.hypot(...offset);
        const velocity = emitterSpeed && distance
            ? offset.map(value => (value / distance) * emitterSpeed)
            : [
                this.#vector(system.velocity, 0) * system.speed,
                -this.#vector(system.velocity, 1) * system.speed,
                this.#vector(system.velocity, 2) * system.speed,
            ];
        const initialAlpha = this.#range(system.alpha) * system.opacity;
        return {
            age: 0,
            alpha: initialAlpha,
            angularVelocity: this.#range(system.angularVelocity),
            color: [0, 1, 2].map(axis => this.#vector(system.color, axis) * system.colorMultiplier[axis]),
            frame: -1,
            initialAlpha,
            lifetime: this.#range(system.lifetime),
            position,
            rotation: this.#range(system.rotation) * system.speed,
            size: ((system.size[0] +
                Math.pow(Math.random(), system.sizeExponent) *
                    (system.size[1] - system.size[0])) *
                system.sizeScale) /
                2,
            velocity,
        };
    }
    #offset(emitter) {
        let result;
        if (emitter.type === "boxrandom") {
            result = [0, 1, 2].map(axis => this.#vector(emitter, axis) *
                (Math.random() < 0.5 ? -1 : 1) *
                (emitter.directions[axis] ?? 0));
        }
        else {
            const angle = Math.random() * Math.PI * 2;
            const distance = (emitter.min[0] ?? 0) +
                Math.sqrt(Math.random()) *
                    ((emitter.max[0] ?? 0) - (emitter.min[0] ?? 0));
            result = [Math.cos(angle) * distance, Math.sin(angle) * distance, 0];
        }
        for (let axis = 0; axis < 3; axis++)
            if (emitter.sign[axis])
                result[axis] = Math.abs(result[axis]) * emitter.sign[axis];
        return result;
    }
    #frame(system, particle, life) {
        const frames = system.frames;
        if (!frames?.length)
            return;
        if (system.animationMode === "randomframe") {
            if (particle.frame < 0)
                particle.frame = Math.floor(Math.random() * frames.length);
        }
        else if (system.animationMode === "once") {
            particle.frame = Math.min(life * frames.length * system.sequenceMultiplier, frames.length - 1);
        }
        else {
            particle.frame =
                (life * frames.length * system.sequenceMultiplier) % frames.length;
        }
    }
    #vertices(system, instances) {
        const particles = new Float32Array(instances.length * 4);
        const colors = new Float32Array(instances.length * 3);
        const rotations = new Float32Array(instances.length);
        const textureRects = new Float32Array(instances.length * 4);
        const frames = system.frames;
        // The particle system's own rotation, applied to each particle's simulated position at render time (matches CParticle.cpp's model matrix).
        const angleCos = Math.cos(system.systemAngle);
        const angleSin = Math.sin(system.systemAngle);
        instances.forEach((particle, index) => {
            const rotatedX = particle.position[0] * angleCos - particle.position[1] * angleSin;
            const rotatedY = particle.position[0] * angleSin + particle.position[1] * angleCos;
            const x = system.origin[0] - system.projection[0] / 2 + rotatedX * system.scale[0];
            // Simulated position delta is subtracted, not added: it's in a different sign convention than `system.origin`'s Y-flip (confirmed via a no-rotation snowfall preset that otherwise rose instead of falling).
            const y = system.projection[1] / 2 - system.origin[1] - rotatedY * system.scale[1];
            particles.set([x, y, particle.size * system.scale[0], particle.alpha], index * 4);
            colors.set(particle.color, index * 3);
            rotations[index] = particle.rotation;
            const frame = frames?.length
                ? frames[Math.floor(particle.frame) % frames.length]
                : null;
            const left = frame?.left ?? 0;
            const top = frame?.top ?? 0;
            textureRects.set([
                left,
                top,
                (frame?.right ?? system.u) - left,
                (frame?.bottom ?? system.v) - top,
            ], index * 4);
        });
        return { colors, particles, rotations, textureRects };
    }
    #fade(life, fadeIn, fadeOut) {
        if (fadeIn > 0 && life < fadeIn)
            return life / fadeIn;
        if (fadeOut < 1 && life > fadeOut)
            return (1 - life) / (1 - fadeOut);
        return 1;
    }
    #range(range) {
        return range[0] + (range[1] - range[0]) * Math.random();
    }
    #vector(range, axis) {
        return ((range.min[axis] ?? 0) +
            ((range.max[axis] ?? 0) - (range.min[axis] ?? 0)) * Math.random());
    }
    #upload(name, size, buffer, data) {
        const location = this.#gl.getAttribLocation(this.#program, name);
        this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, buffer);
        this.#gl.bufferData(this.#gl.ARRAY_BUFFER, data, this.#gl.STREAM_DRAW);
        this.#gl.enableVertexAttribArray(location);
        this.#gl.vertexAttribPointer(location, size, this.#gl.FLOAT, false, 0, 0);
    }
}
