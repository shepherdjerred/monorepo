// Replay composition for complete post-loaded quad graphs. Scheduling, seed,
// actor basis and scene inputs remain explicit preview conventions.
import { createLatestVfxBoundQuads } from "./latest-vfx-bound-quads.mjs";
import { decodeLatestVfxQuadVertices } from "./latest-vfx-quad-vertices.mjs";
import { sampleLatestMissileTrace } from "./latest-missile-playback.mjs";
import { sha256 } from "./structural-comparison.mjs";

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v) => {
  const length = Math.hypot(...v);
  if (!(length > 0)) throw Error("Degenerate bound playback actor basis");
  return v.map((n) => n / length);
};
export function boundPlaybackInput(
  trace,
  elapsed,
  previousElapsed,
  camera,
  multTexturePresent,
) {
  const pose = (t) =>
    sampleLatestMissileTrace(
      trace,
      Math.min(trace.startTime + t, trace.stopTime ?? Infinity),
    );
  const current = pose(elapsed),
    previous = pose(previousElapsed),
    forward = unit(current.direction);
  const reference = Math.abs(forward[1]) < 0.999 ? [0, 1, 0] : [0, 0, 1],
    left = unit(cross(forward, reference)),
    up = unit(cross(left, forward));
  // Supplied actor convention: local Y follows flight, local Z is up.
  return {
    time: elapsed,
    previous: previous.position,
    current: current.position,
    basis: [...left, 0, ...forward, 0, ...up, 0, 0, 0, 0, 1],
    viewPosition: camera.position,
    cameraRight: camera.right,
    cameraUp: camera.up,
    viewAxis: camera.axis,
    multTexturePresent,
  };
}

export async function createLatestVfxBoundPlayback({
  uc,
  profile,
  image,
  spawnBytes,
  emitterBytes,
  postloadBytes,
  definitionBytes,
  effectsManifestBytes,
  loadGraphBytes,
  captureEvidence = false,
  math,
}) {
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    typeof loadGraphBytes !== "function" ||
    !meta.templates.length ||
    (await sha256(effectsManifestBytes)) !==
      JSON.parse(new TextDecoder().decode(postloadBytes)).effectsManifestSha256
  )
    throw Error("Bound playback effect/graph package mismatch");
  const kernel = await createLatestVfxBoundQuads(
    uc,
    profile,
    image,
    spawnBytes,
    emitterBytes,
    postloadBytes,
    definitionBytes,
    await loadGraphBytes(meta.templates[0].file),
    math,
  );
  const bindings = new Map(),
    instances = new Map(),
    drained = new Map(),
    samples = new Map();
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
    async bindEmitter(effectId, compiled, sourceDefinitionSha256) {
      if (closed) throw Error("Bound playback is closed");
      const key = `${effectId}:${compiled.index}`;
      if (bindings.has(key)) throw Error("Duplicate bound playback emitter");
      // This caller still admits the finite, unit-count single-particle subset.
      // Full asset bytes are used; this is not a projection into the old schema.
      if (
        compiled.delay !== 0 ||
        !(compiled.life > 0) ||
        compiled.life >= 29 ||
        ![1, true].includes(compiled.emitter.isSingleParticle) ||
        compiled.emitter.rate?.constantValue !== 1 ||
        compiled.emitter.rate?.dynamics
      )
        throw Error(
          "Bound playback requires a finite zero-delay single particle",
        );
      const ref = meta.templates.find(
        (entry) =>
          entry.effectId === effectId && entry.emitterIndex === compiled.index,
      );
      if (
        !ref ||
        ref.sourceDefinitionSha256 !== sourceDefinitionSha256 ||
        ref.hasMultDefinition !== !!compiled.multTexture
      )
        throw Error("Bound playback has no matching complete asset graph");
      const handle = await kernel.loadGraph(await loadGraphBytes(ref.file));
      if (closed) throw Error("Bound playback closed while loading a graph");
      bindings.set(key, {
        handle,
        ref,
        compiled,
        endTick: Math.ceil(Math.fround(compiled.life) * 60) + 1,
      });
    },
    beginFrame(time) {
      if (closed || !Number.isFinite(time))
        throw Error("Invalid bound playback frame time");
      for (const [key, instance] of instances) {
        const age = time - instance.trace.startTime;
        if (age < 0 || age > instance.binding.endTick / 60)
          releaseInstance(key, instance);
      }
    },
    sample(trace, emitterIndex, time, camera) {
      if (
        closed ||
        !Number.isFinite(time) ||
        !Number.isSafeInteger(trace.sequence)
      )
        throw Error("Invalid bound playback sample");
      const binding = bindings.get(`${trace.effectId}:${emitterIndex}`),
        age = time - trace.startTime;
      if (!binding) throw Error("Unbound complete particle graph");
      if (age < 0) return null;
      const key = `${trace.sequence}:${emitterIndex}`,
        empty = drained.get(key);
      let instance = instances.get(key);
      if (empty && (empty.trace !== trace || empty.binding !== binding))
        throw Error("Bound drained-instance identity collision");
      if (empty && Math.fround(age) >= empty.emptyAfter) {
        if (instance) releaseInstance(key, instance);
        return null;
      }
      const input = (t, previous) =>
        boundPlaybackInput(
          trace,
          t,
          previous,
          camera,
          binding.ref.hasMultDefinition,
        );
      if (!instance) {
        kernel.selectGraph(binding.handle);
        kernel.reset(0n, 0);
        kernel.advance(input(0, 0));
        const initial = { handle: kernel.checkpoint(), tick: 0 };
        instance = { trace, binding, birth: initial, cached: initial };
        instances.set(key, instance);
      }
      if (instance.trace !== trace || instance.binding !== binding)
        throw Error("Bound playback instance identity collision");
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
      for (let i = instance.cached.tick + 1; i <= tick; i++)
        kernel.advance(input(i / 60, (i - 1) / 60));
      if (tick !== instance.cached.tick) {
        releaseCached(instance);
        instance.cached = { handle: kernel.checkpoint(), tick };
      }
      if (target > tick / 60) kernel.advance(input(target, tick / 60));
      const state = kernel.readState(),
        count = state.vectors.life.count;
      if (count > 1)
        throw Error("Complete graph violated single-particle admission");
      if (age >= binding.endTick / 60 && count !== 0)
        throw Error("Complete single-particle graph did not drain");
      if (captureEvidence) {
        const inputs = Array.from({ length: tick + 1 }, (_, i) =>
          input(i / 60, Math.max(0, i - 1) / 60),
        );
        if (target > tick / 60) inputs.push(input(target, tick / 60));
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
      if (count === 0) {
        // A zero pool alone is not a permanent-empty proof. Require the native
        // single-particle birth guard and the authored lifetime to have elapsed.
        const actor = Uint8Array.from(state.actorHex.match(/../g), (n) =>
          parseInt(n, 16),
        );
        if (target >= Math.fround(binding.compiled.life) && actor[0x18] & 4) {
          drained.set(key, {
            trace,
            binding,
            emptyAfter: Math.min(target, empty?.emptyAfter ?? Infinity),
          });
          releaseInstance(key, instance);
        }
        return null;
      }
      const lifeBytes = Uint8Array.from(
        state.vectors.life.hex.match(/../g),
        (n) => parseInt(n, 16),
      );
      const lifeView = new DataView(lifeBytes.buffer),
        life = lifeView.getFloat32(4, true),
        particleAge = Math.fround(target - lifeView.getFloat32(0, true));
      if (life !== Math.fround(binding.compiled.life) || particleAge < 0)
        throw Error("Complete native lifetime disagrees with admission");
      const geometry = kernel.renderGeometry(camera.position, {
        right: camera.right,
        up: camera.up,
        axis: camera.axis,
        multTexturePresent: binding.ref.hasMultDefinition,
      });
      if (captureEvidence) samples.get(`${key}:${target}`).geometry = geometry;
      return {
        geometry,
        graphSha256: binding.ref.sha256,
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
        [...instances.values()].flatMap((instance) => [
          instance.birth.handle,
          instance.cached.handle,
        ]),
      );
      return {
        preparedEmitters: bindings.size,
        instances: instances.size,
        drainedInstances: drained.size,
        checkpointBytes: [...handles].reduce(
          (total, handle) => total + handle.bytes,
          0,
        ),
        definitionSha256: profile.vfxBoundQuadsSha256,
        policy:
          "Complete unchanged post-loaded quad assets; original coupled birth/update/removal/UV/vertex routines. Supplied 60 Hz clock plus fractional update, missile-start activation, seed zero, quality zero, unit scene inputs and local-Y travel basis. Original activation, scene inputs and scheduling remain unrecovered.",
      };
    },
    close() {
      if (closed) return;
      for (const [key, instance] of instances) releaseInstance(key, instance);
      bindings.clear();
      drained.clear();
      samples.clear();
      kernel.close();
      closed = true;
    },
  };
}

export function sampleLatestBoundVfxDraws(
  playback,
  definitions,
  time,
  runtime,
  camera,
) {
  runtime.beginFrame(time);
  const draws = [];
  for (const trace of playback.traces) {
    const definition = definitions.get(trace.effectId);
    if (!definition) throw Error("Complete particle definition missing");
    if (
      time < trace.startTime ||
      (trace.stopTime !== null && trace.startTime > trace.stopTime) ||
      (trace.stopTime !== null &&
        time > trace.stopTime &&
        !trace.renderParticlesAfterDestroy)
    )
      continue;
    for (const compiled of definition.supported) {
      const sample = runtime.sample(trace, compiled.index, time, camera);
      if (sample === null) continue;
      const geometry = decodeLatestVfxQuadVertices(sample.geometry);
      if (geometry.vertices.length !== 4 || geometry.indices.length !== 6)
        throw Error("Unexpected complete single-particle geometry");
      draws.push({
        key: `${trace.sequence}:${compiled.index}`,
        sequence: trace.sequence,
        effectId: trace.effectId,
        entityId: trace.entityId,
        emitter: compiled.index,
        graphSha256: sample.graphSha256,
        nativeGeometry: sample.geometry,
        positions: geometry.vertices.map((v) => v.position),
        uv: geometry.vertices.map((v) => v.uv),
        multUv: geometry.vertices.map((v) => v.multUv),
        indices: geometry.indices,
        colors: geometry.vertices.map((v) => v.color),
        texture: compiled.texture,
        multTexture: compiled.multTexture,
        baseSampler: compiled.baseSampler,
        multSampler: compiled.multSampler,
        blend: compiled.emitter.blendMode,
        depthTest: !(compiled.emitter.miscRenderFlags & 1),
        doubleSide: !!compiled.emitter.disableBackfaceCull,
        pass: compiled.emitter.pass ?? 0,
        age: sample.age,
        life: sample.life,
        fraction: sample.fraction,
      });
    }
  }
  return draws;
}
