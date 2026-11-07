import { sha256 } from "./structural-comparison.mjs";
import {
  createLatestVfxUvAnimation,
  uvAnimationPreviewMath,
} from "./latest-vfx-uv-animation.mjs";

// Replay presentation adapter for deterministic UV inputs only. Birth at
// normalized emitter age zero follows the preview's existing activation policy.
export async function createLatestVfxUvPlayback({
  uc,
  profile,
  image,
  definitionBytes,
  effectsManifestBytes,
  loadGraphBytes,
  math = uvAnimationPreviewMath,
}) {
  const meta = JSON.parse(new TextDecoder().decode(definitionBytes));
  if (
    (await sha256(effectsManifestBytes)) !== meta.effectsManifestSha256 ||
    typeof loadGraphBytes !== "function"
  )
    throw Error("UV playback/static effects mismatch");
  const bindings = new Map(),
    prepared = new Map();
  for (const binding of meta.bindings) {
    const key = `${binding.effectId}:${binding.emitterIndex}`;
    if (bindings.has(key)) throw Error("Duplicate UV asset binding");
    bindings.set(key, binding);
  }
  const kernel = await createLatestVfxUvAnimation(
    uc,
    profile,
    image,
    definitionBytes,
    math,
  );
  const identity = [1, 0, 0, 1, 0, 0];
  function matrix(hex) {
    if (hex === null) return [...identity]; // Native link disabled this record.
    if (!/^[0-9a-f]{48}$/.test(hex))
      throw Error("Invalid native UV matrix bytes");
    const bytes = Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
    const view = new DataView(bytes.buffer);
    const values = Array.from({ length: 6 }, (_, i) =>
      view.getFloat32(i * 4, true),
    );
    if (!values.every(Number.isFinite))
      throw Error("Nonfinite native UV matrix");
    return values;
  }
  function randomFields(value) {
    if (!value || typeof value !== "object") return false;
    if (value.probabilityTables?.some((t) => t?.keyTimes?.length)) return true;
    return Object.entries(value).some(
      ([key, v]) => key !== "probabilityTables" && randomFields(v),
    );
  }
  return {
    async bindEmitter(effectId, compiled, sourceDefinitionSha256) {
      const key = `${effectId}:${compiled.index}`;
      if (prepared.has(key)) throw Error("UV emitter already bound");
      if (
        !(Math.fround(compiled.life) > 0) ||
        !Number.isFinite(Math.fround(compiled.life))
      )
        throw Error("Invalid UV particle lifetime");
      if (randomFields(compiled.emitter))
        throw Error("Randomized UV playback requires match RNG binding");
      const binding = bindings.get(key);
      if (!binding || binding.sourceDefinitionSha256 !== sourceDefinitionSha256)
        throw Error("Unprepared UV emitter/source binding");
      const reference = meta.templates.find(
        (t) => t.sha256 === binding.graphSha256,
      );
      if (!reference) throw Error("Missing prepared UV graph");
      const bytes = await loadGraphBytes(reference.file);
      if ((await sha256(bytes)) !== reference.sha256)
        throw Error("UV playback graph hash mismatch");
      const selected = await kernel.loadGraph(bytes);
      kernel.birth({ emitterAge: 0, chance: 0 });
      prepared.set(key, {
        particle: kernel.captureParticle(),
        life: Math.fround(compiled.life),
        flags: selected.flags,
        graphSha256: reference.sha256,
      });
    },
    sample(effectId, emitterIndex, age, life) {
      const binding = prepared.get(`${effectId}:${emitterIndex}`);
      if (
        !binding ||
        Math.fround(life) !== binding.life ||
        !Number.isFinite(age) ||
        age < 0
      )
        throw Error("Unbound UV playback particle");
      const elapsed = Math.fround(age);
      // Deterministic graph/birth handles have no evolving UV state. Missiles
      // from the same cast often request the same float32 age; reuse that exact
      // result while keeping returned arrays private from future requests.
      if (binding.lastSample && Object.is(binding.lastAge, elapsed))
        return {
          ...binding.lastSample,
          base: [...binding.lastSample.base],
          mult: [...binding.lastSample.mult],
          raw: { ...binding.lastSample.raw },
          flags: { ...binding.lastSample.flags },
        };
      const value = kernel.sampleParticle(binding.particle, {
        age: elapsed,
        normalizedAge: Math.fround(
          Math.min(1, Math.max(0, Math.fround(elapsed / binding.life))),
        ),
        lifetime: binding.life,
        chance: 0,
      });
      const result = {
        base: matrix(value.matrices.base),
        mult: matrix(value.matrices.mult),
        raw: { ...value.matrices },
        flags: { ...binding.flags },
        graphSha256: binding.graphSha256,
      };
      binding.lastAge = elapsed;
      binding.lastSample = {
        ...result,
        base: [...result.base],
        mult: [...result.mult],
        raw: { ...result.raw },
        flags: { ...result.flags },
      };
      return result;
    },
    get summary() {
      return {
        preparedEmitters: prepared.size,
        definitionSha256: profile.vfxUvAnimationSha256,
        policy:
          "Native UV functions on deterministic authored inputs; birth normalized emitter age and shared chance are zero under the existing preview activation policy. Texture basis/sampling and original shader remain unverified.",
      };
    },
    close() {
      prepared.clear();
      kernel.close();
    },
  };
}
