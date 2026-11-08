// Shared preview lifecycle for admitted complete native emitter runtimes.
// Activation, stop suspension, cadence and seed remain supplied policies.
import { boundPlaybackInput } from "./latest-vfx-bound-playback.mjs";
import { sha256 } from "./structural-comparison.mjs";

export const PARTICLE_CONTROL_SHA =
  "a8c8d19179dbca8bfa71e329ce9cc53e1df9a56ed7d743bb622041ef9f8d5150";

export function createLatestParticlePlayback(
  runtime,
  control,
  meta,
  loadGraphBytes,
  { captureEvidence = false } = {},
) {
  const bindings = new Map(),
    instances = new Map(),
    drained = new Map(),
    evidence = [];
  let closed = false;
  const release = (key, instance) => {
    if (instance.saved !== instance.birth)
      runtime.releaseCheckpoint(instance.saved.handle);
    runtime.releaseCheckpoint(instance.birth.handle);
    instances.delete(key);
  };
  const result = {
    async bindEmitter(effectId, emitterIndex, sourceDefinitionSha256) {
      if (closed) throw Error("Closed particle playback");
      const key = `${effectId}:${emitterIndex}`,
        ref = meta.templates.find(
          (t) => t.effectId === effectId && t.emitterIndex === emitterIndex,
        );
      if (
        bindings.has(key) ||
        !ref ||
        ref.sourceDefinitionSha256 !== sourceDefinitionSha256
      )
        throw Error("Unprepared/duplicate complete particle binding");
      const bytes = await loadGraphBytes(ref.file);
      if ((await sha256(bytes)) !== ref.sha256)
        throw Error("Particle playback graph changed");
      const handle = await runtime.loadGraph(bytes);
      if (closed) throw Error("Particle playback closed during graph load");
      bindings.set(key, { ref, handle });
    },
    beginFrame(time) {
      if (closed || !Number.isFinite(time))
        throw Error("Invalid particle display time");
      for (const [key, instance] of instances)
        if (time < instance.trace.startTime) release(key, instance);
    },
    sample(trace, emitterIndex, time, camera) {
      if (
        closed ||
        !Number.isFinite(time) ||
        !Number.isSafeInteger(trace.sequence)
      )
        throw Error("Invalid replay particle sample");
      const binding = bindings.get(`${trace.effectId}:${emitterIndex}`),
        age = time - trace.startTime;
      if (!binding) throw Error("Unbound replay trail");
      if (age < 0) return null;
      if (trace.stopTime === null || trace.stopTime < trace.startTime)
        throw Error(
          "Particle preview requires an observed terminal missile clock",
        );
      const stop = Math.fround(trace.stopTime - trace.startTime),
        key = `${trace.sequence}:${emitterIndex}`,
        empty = drained.get(key);
      if (empty) {
        if (empty.trace !== trace || empty.binding !== binding)
          throw Error("Particle identity collision");
        if (Math.fround(age) >= empty.time) return null;
      }
      const input = (t, previous) =>
        boundPlaybackInput(
          trace,
          t,
          previous,
          camera,
          binding.ref.hasMultDefinition,
        );
      let instance = instances.get(key);
      if (!instance) {
        runtime.selectGraph(binding.handle);
        runtime.reset(0n, 0);
        control.applySuspended(stop === 0);
        runtime.advance(input(0, 0));
        const birth = {
          handle: runtime.checkpoint(),
          tick: 0,
          time: 0,
          suspended: stop === 0,
        };
        instance = { trace, binding, birth, saved: birth };
        instances.set(key, instance);
      }
      if (instance.trace !== trace || instance.binding !== binding)
        throw Error("Particle instance identity collision");
      const target = Math.fround(Math.min(age, 30));
      if (target < instance.saved.time) {
        if (instance.saved !== instance.birth)
          runtime.releaseCheckpoint(instance.saved.handle);
        instance.saved = instance.birth;
      }
      runtime.restore(instance.saved.handle);
      let { time: previous, tick, suspended } = instance.saved,
        done = false;
      const steps = [];
      // Keep complete tick history independent of display sampling. Insert the
      // supplied stop instant so suspension cannot shift to the next display.
      while (previous < target) {
        let next = Math.min(Math.fround((tick + 1) / 60), target);
        if (!suspended && stop > previous) next = Math.min(next, stop);
        if (next <= previous) throw Error("Particle clock failed to advance");
        if (!suspended && next >= stop) {
          control.applySuspended(true);
          suspended = true;
        }
        const inp = input(next, previous);
        runtime.advance(inp);
        steps.push(inp);
        previous = next;
        if (next === Math.fround((tick + 1) / 60)) tick++;
        const k = runtime.kernel,
          count = k.readU32(k.q(k.a.actor + 0xa0) + 0x10);
        if (count > runtime.metadata.maximumParticles)
          throw Error("Native particle pool exceeds admission");
        if (suspended && count === 0) {
          done = true;
          break;
        }
        // Only complete fixed ticks or the exact stop boundary are durable.
        // A fractional display frame must not change future simulation history.
        const nextCanonical = Math.min(
          Math.fround((tick + 1) / 60),
          !suspended && stop > next ? stop : Infinity,
        );
        if (
          (next === Math.fround(tick / 60) || next === stop) &&
          nextCanonical > target
        ) {
          if (instance.saved !== instance.birth)
            runtime.releaseCheckpoint(instance.saved.handle);
          instance.saved = {
            handle: runtime.checkpoint(),
            tick,
            time: next,
            suspended,
          };
        }
      }
      const state = runtime.readState();
      if (suspended && state.vectors.life.count === 0) done = true;
      if (captureEvidence)
        evidence.push({
          sequence: trace.sequence,
          emitterIndex,
          graphSha256: binding.ref.sha256,
          target,
          steps,
          state,
          done,
        });
      if (done) {
        drained.set(key, { trace, binding, time: previous });
        release(key, instance);
        return null;
      }
      if (age > 30)
        throw Error(
          "Live particle exceeds the admitted 30-second native component window",
        );
      const geometry = runtime.renderGeometry(camera.position, {
        right: camera.right,
        up: camera.up,
        axis: camera.axis,
        multTexturePresent: binding.ref.hasMultDefinition,
      });
      if (captureEvidence) evidence.at(-1).geometry = geometry;
      return {
        geometry,
        graphSha256: binding.ref.sha256,
        particleCount: state.vectors.life.count,
      };
    },
    get evidence() {
      return structuredClone(evidence);
    },
    get summary() {
      return {
        preparedEmitters: bindings.size,
        instances: instances.size,
        drained: drained.size,
        policy:
          "Complete native CameraParticle assets and pool/writer execution. Supplied missile-start activation, stop-time birth suspension, 60 Hz cadence, seed zero, quality zero and local-Y travel basis. Native parent activation/retirement and original scene bindings unresolved.",
      };
    },
    close() {
      if (closed) return;
      for (const [key, i] of instances) release(key, i);
      bindings.clear();
      drained.clear();
      control.close();
      runtime.close();
      closed = true;
    },
  };
  return result;
}
