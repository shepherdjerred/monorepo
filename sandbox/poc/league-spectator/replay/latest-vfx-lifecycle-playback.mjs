import { createLatestVfxLegacyQuads } from "./latest-vfx-legacy-quads.mjs";
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";
import { sha256 } from "./structural-comparison.mjs";

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v) => {
  const length = Math.hypot(...v);
  if (!(length > 0)) throw Error("Degenerate preview actor basis");
  return v.map((n) => n / length);
};
function inputAt(trace, time, previousTime) {
  const pose = (t) =>
      sampleLatestMissileTrace(
        trace,
        Math.min(trace.startTime + t, trace.stopTime ?? Infinity),
      ),
    current = pose(time),
    previous = pose(previousTime),
    forward = unit(current.direction),
    reference = Math.abs(forward[1]) < 0.999 ? [0, 1, 0] : [0, 0, 1],
    left = unit(cross(forward, reference)),
    up = unit(cross(left, forward));
  // Explicit caller convention: local Y follows missile travel, local Z is up.
  // The original actor-to-system orientation binding is not recovered.
  return {
    time,
    previous: previous.position,
    current: current.position,
    basis: [...left, 0, ...forward, 0, ...up, 0, 0, 0, 0, 1],
    viewPosition: [0, 0, 0],
  };
}
const persistent = (state) => ({
  vectors: state.vectors,
  rngHex: state.rngHex,
  actorHex: state.actorHex,
  poolHex: state.poolHex,
});
const view = (hex) => {
  if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})*$/.test(hex))
    throw Error("Invalid native lifecycle bytes");
  return new DataView(
    Uint8Array.from(hex.match(/../g) ?? [], (n) => parseInt(n, 16)).buffer,
  );
};
const floats = (data, at, count) =>
  Array.from({ length: count }, (_, i) => data.getFloat32(at + i * 4, true));

export async function createLatestVfxLifecyclePlayback({
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  definitionBytes,
  effectsManifestBytes,
  loadGraphBytes,
  captureEvidence = false,
}) {
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    (await sha256(effectsManifestBytes)) !== meta.effectsManifestSha256 ||
    typeof loadGraphBytes !== "function" ||
    !meta.templates.length
  )
    throw Error("Lifecycle playback/effect package mismatch");
  const kernel = await createLatestVfxLegacyQuads(
      uc,
      profile,
      image,
      spawnBytes,
      emitterBytes,
      definitionBytes,
      await loadGraphBytes(meta.templates[0].file),
    ),
    bindings = new Map(),
    instances = new Map(),
    samples = new Map(),
    drained = new Map();
  let closed = false;
  const releaseCached = (instance) => {
    if (instance.cached.handle !== instance.birth.handle)
      kernel.releaseCheckpoint(instance.cached.handle);
  };
  const releaseInstance = (key, instance) => {
    releaseCached(instance);
    kernel.releaseCheckpoint(instance.birth.handle);
    instances.delete(key);
  };
  return {
    beginFrame(time) {
      if (closed || !Number.isFinite(time))
        throw Error("Invalid lifecycle frame time");
      // Eviction affects caching only; a later query reconstructs native state.
      for (const [key, instance] of instances) {
        const age = time - instance.trace.startTime;
        if (age < 0 || age > instance.binding.endTick / 60)
          releaseInstance(key, instance);
      }
    },
    async bindEmitter(effectId, compiled, sourceDefinitionSha256) {
      if (closed) throw Error("Lifecycle playback is closed");
      const key = `${effectId}:${compiled.index}`;
      if (bindings.has(key)) throw Error("Duplicate lifecycle emitter binding");
      if (compiled.delay !== 0 || !(compiled.life > 0) || compiled.life >= 29)
        throw Error(
          "Lifecycle playback requires zero-delay, bounded single-particle life",
        );
      if (
        ![1, true].includes(compiled.emitter.isSingleParticle) ||
        compiled.emitter.rate?.constantValue !== 1 ||
        compiled.emitter.rate?.dynamics
      )
        throw Error("Native lifecycle requires one non-repeating particle");
      const ref = meta.templates.find(
        (t) => t.effectId === effectId && t.emitterIndex === compiled.index,
      );
      if (!ref || ref.sourceDefinitionSha256 !== sourceDefinitionSha256)
        throw Error("Unprepared lifecycle emitter/source");
      const handle = await kernel.loadGraph(await loadGraphBytes(ref.file));
      if (closed)
        throw Error("Lifecycle playback closed while loading a graph");
      bindings.set(key, {
        handle,
        ref,
        compiled,
        endTick: Math.ceil(Math.fround(compiled.life) * 60) + 1,
      });
    },
    sample(trace, emitterIndex, time, uvPlayback) {
      if (
        closed ||
        !Number.isFinite(time) ||
        typeof uvPlayback?.sample !== "function"
      )
        throw Error("Invalid lifecycle playback request");
      const binding = bindings.get(`${trace.effectId}:${emitterIndex}`),
        age = time - trace.startTime;
      if (!binding) throw Error("Unbound native lifecycle emitter");
      if (age < 0) return null;
      if (!Number.isSafeInteger(trace.sequence))
        throw Error("Invalid native lifecycle instance identity");
      const key = `${trace.sequence}:${emitterIndex}`;
      let instance = instances.get(key);
      const emptyProof = drained.get(key);
      if (
        emptyProof &&
        (emptyProof.trace !== trace || emptyProof.binding !== binding)
      )
        throw Error("Lifecycle drained-instance identity collision");
      if (emptyProof && Math.fround(age) >= emptyProof.emptyAfter) {
        if (instance) releaseInstance(key, instance);
        return null;
      }
      if (!instance) {
        kernel.selectGraph(binding.handle);
        kernel.reset(0n, 0);
        kernel.advance(inputAt(trace, 0, 0));
        const state = persistent(kernel.readState()),
          initial = { handle: kernel.checkpoint(), tick: 0, state };
        instance = { trace, binding, birth: initial, cached: initial };
        instances.set(key, instance);
      }
      if (instance.trace !== trace || instance.binding !== binding)
        throw Error("Lifecycle instance identity collision");
      // Native removal is executed and checked at the bounded drain time before
      // culling later requests. The fixed 60 Hz clock and fractional display
      // update are supplied preview scheduling, not recovered League scheduling.
      const target = Math.min(
          Math.fround(age),
          Math.fround(binding.endTick / 60),
        ),
        tick = Math.min(binding.endTick, Math.floor(target * 60));
      if (tick < instance.cached.tick) {
        releaseCached(instance);
        instance.cached = instance.birth;
      }
      kernel.restore(instance.cached.handle);
      let state = instance.cached.state;
      for (let i = instance.cached.tick + 1; i <= tick; i++) {
        kernel.advance(inputAt(trace, i / 60, (i - 1) / 60));
      }
      if (tick !== instance.cached.tick) {
        state = persistent(kernel.readState());
        releaseCached(instance);
        instance.cached = { handle: kernel.checkpoint(), tick, state };
      }
      if (target > tick / 60) {
        kernel.advance(inputAt(trace, target, tick / 60));
        state = persistent(kernel.readState());
      }
      if (captureEvidence) {
        const inputs = Array.from({ length: tick + 1 }, (_, i) =>
          inputAt(trace, i / 60, Math.max(0, i - 1) / 60),
        );
        if (target > tick / 60) inputs.push(inputAt(trace, target, tick / 60));
        samples.set(`${key}:${target}`, {
          graphSha256: binding.ref.sha256,
          sequence: trace.sequence,
          emitterIndex,
          seedHex: "0000000000000000",
          quality: 0,
          inputs,
          state,
        });
      }
      const count = state.vectors.life.count;
      if (count > 1)
        throw Error("Native lifecycle violated single-particle admission");
      if (age >= binding.endTick / 60 && count !== 0)
        throw Error("Native lifecycle did not drain within admitted window");
      if (
        count === 0 &&
        instance.birth.state.vectors.life.count === 1 &&
        target >= Math.fround(binding.compiled.life)
      ) {
        // Original single-particle dispatch at 0x175850d..0x175853d skips
        // further births once runtime actor byte +0x18 has bit 4 set.
        if (!(view(state.actorHex).getUint8(0x18) & 4))
          throw Error("Native single-particle emission guard is absent");
        // This admitted single particle was born and the original update has
        // removed it. Preserve the earliest observed empty timestamp, rather
        // than rebuilding an expired emitter merely to re-prove emptiness.
        drained.set(key, {
          trace,
          binding,
          emptyAfter: Math.min(target, emptyProof?.emptyAfter ?? Infinity),
        });
        releaseInstance(key, instance);
      }
      if (count === 0) return null;
      const lifeView = view(state.vectors.life.hex),
        particleAge = Math.fround(target - lifeView.getFloat32(0, true)),
        life = lifeView.getFloat32(4, true);
      if (life !== Math.fround(binding.compiled.life) || particleAge < 0)
        throw Error("Native particle life disagrees with admission");
      const uv = uvPlayback.sample(
          trace.effectId,
          emitterIndex,
          particleAge,
          life,
        ),
        uvInput = {
          base: uv.raw.base === null ? null : uv.base,
          mult: uv.raw.mult === null ? null : uv.mult,
          multBound: !!binding.compiled.multTexture,
        },
        output = kernel.renderGeometry([0, 0, 0], uvInput),
        p = view(state.vectors.particle.hex),
        a = view(state.vectors.attributes.hex),
        actor = view(state.actorHex);
      const quadInput = {
        vertexFormat: 0,
        baseVertex: 0,
        blend: binding.compiled.emitter.blendMode,
        uniformScale: !!binding.compiled.emitter.isUniformScale,
        multBound: uvInput.multBound,
        modulation: [1, 1, 1, 1],
        systemScale: [1, 1],
        actorUvOffset: floats(actor, 0x28, 2),
        directionScale: 0,
        directionMinScale: 0,
        projectionScroll: 0,
        viewPosition: [0, 0, 0],
        particles: [
          {
            position: floats(p, 0x80, 3),
            basisX: floats(p, 0x50, 3),
            basisY: floats(p, 0x60, 3),
            basisZ: floats(p, 0x70, 3),
            direction: floats(p, 0x90, 3),
            color: floats(a, 4, 4),
            size: floats(a, 0x14, 2),
            frame: a.getFloat32(0, true),
            aux: a.getFloat32(0x28, true),
            uvOffset: floats(a, 0x20, 2),
            baseUV: uvInput.base,
            multUV: uvInput.mult,
          },
        ],
      };
      return {
        quadInput,
        quadOutput: output,
        uvTransforms: uv,
        age: particleAge,
        life,
        fraction: particleAge / life,
      };
    },
    get evidenceSamples() {
      return [...samples.values()];
    },
    get summary() {
      const handles = new Set(
        [...instances.values()].flatMap((i) => [
          i.birth.handle,
          i.cached.handle,
        ]),
      );
      return {
        preparedEmitters: bindings.size,
        instances: instances.size,
        drainedInstances: drained.size,
        checkpointBytes: [...handles].reduce((n, h) => n + h.bytes, 0),
        definitionSha256: profile.vfxLegacyQuadsSha256,
        policy:
          "Original legacy quad birth/update/removal and vertex assembly. Supplied 60 Hz clock plus fractional display update; activation at missile start, seed zero, quality zero, unit root/system scale and preview local-Y travel basis. Original replay activation, orientation, clock and RNG binding remain unresolved.",
      };
    },
    close() {
      if (closed) return;
      for (const instance of instances.values()) {
        releaseCached(instance);
        kernel.releaseCheckpoint(instance.birth.handle);
      }
      instances.clear();
      bindings.clear();
      samples.clear();
      drained.clear();
      kernel.close();
      closed = true;
    },
  };
}
