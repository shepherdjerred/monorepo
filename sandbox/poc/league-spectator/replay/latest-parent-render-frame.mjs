// Checked native buffers and prepared material bindings for complete parents.
// Scene inputs, blending pass order and replay lifetime remain supplied policy.
import { sha256 } from "./structural-comparison.mjs";
import { assertLatestSelectedMaterials } from "./latest-selected-materials.mjs";
import {
  PARENT_QUAD_GPU_SHA,
  PARENT_TRAIL_GPU_SHA,
  PARENT_EROSION_GPU_SHA,
} from "./latest-parent-material-contract.mjs";
export {
  PARENT_QUAD_GPU_SHA,
  PARENT_TRAIL_GPU_SHA,
  PARENT_EROSION_GPU_SHA,
} from "./latest-parent-material-contract.mjs";
const WRITERS = new Map([
  [0x23f23b0, "camera-quad"],
  [0x23f20c8, "arbitrary-quad"],
  [0x23f6520, "camera-trail"],
  [0x23f26e0, "ray"],
  [0x23f6678, "arbitrary-trail"],
]);
const parse = (b) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
const uint = (v) => Number.isSafeInteger(v) && v >= 0 && v <= 0xffffffff;
const finiteVector = (v, n) =>
  Array.isArray(v) && v.length === n && v.every(Number.isFinite);

export function parentGeometryAttributes(geometry) {
  const { vertices, indices, draw, particleCount, kind } = geometry;
  if (
    !(vertices instanceof Uint8Array) ||
    !(indices instanceof Uint8Array) ||
    !(draw instanceof Uint8Array) ||
    draw.length !== 16 ||
    !uint(particleCount) ||
    particleCount > 1024 ||
    vertices.length % 28 ||
    indices.length % 2 ||
    ![...WRITERS.values()].includes(kind)
  )
    throw Error("Malformed complete-parent geometry buffers");
  const count = vertices.length / 28,
    ni = indices.length / 2,
    trail = kind === "camera-trail" || kind === "arbitrary-trail";
  if (
    trail
      ? count > particleCount * 2 ||
        ni > Math.max(0, particleCount - 1) * 6 ||
        ni % 6
      : count !== particleCount * 4 || ni !== particleCount * 6
  )
    throw Error("Complete-parent primitive vertex/index counts differ");
  const view = new DataView(
      vertices.buffer,
      vertices.byteOffset,
      vertices.byteLength,
    ),
    iv = new DataView(indices.buffer, indices.byteOffset, indices.byteLength);
  const position = new Float32Array(count * 3),
    color = new Uint8Array(count * 4),
    uv = new Uint16Array(count * 4),
    mult = new Uint16Array(count * 2),
    index = new Uint16Array(ni);
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 3; j++) {
      const value = view.getFloat32(i * 28 + j * 4, true);
      if (!Number.isFinite(value))
        throw Error("Non-finite complete-parent position");
      position[i * 3 + j] = value;
    }
    color.set(vertices.subarray(i * 28 + 12, i * 28 + 16), i * 4);
    for (let j = 0; j < 4; j++)
      uv[i * 4 + j] = view.getUint16(i * 28 + 16 + j * 2, true);
    for (let j = 0; j < 2; j++)
      mult[i * 2 + j] = view.getUint16(i * 28 + 24 + j * 2, true);
  }
  for (let i = 0; i < ni; i++) {
    const value = iv.getUint16(i * 2, true);
    if (value >= count)
      throw Error("Complete-parent index exceeds its vertices");
    index[i] = value;
  }
  return {
    a_POSITION: position,
    a_COLOR: color,
    a_TEXCOORD: uv,
    a_TEXCOORD1: mult,
    index,
  };
}

export async function createParentRenderFrames({
  effectsManifestBytes,
  quadPackageBytes,
  trailPackageBytes,
  erosionPackageBytes,
  selectedMaterials = null,
}) {
  if (selectedMaterials !== null)
    await assertLatestSelectedMaterials(selectedMaterials).assertPackages({
      effectsManifestBytes,
      quadPackageBytes,
      trailPackageBytes,
      erosionPackageBytes,
    });
  else if (
    (await sha256(quadPackageBytes)) !== PARENT_QUAD_GPU_SHA ||
    (await sha256(trailPackageBytes)) !== PARENT_TRAIL_GPU_SHA ||
    (erosionPackageBytes !== undefined &&
      (await sha256(erosionPackageBytes)) !== PARENT_EROSION_GPU_SHA)
  )
    throw Error("Complete-parent material package hash differs");
  const manifest = parse(effectsManifestBytes),
    packages = [
      parse(quadPackageBytes),
      ...(trailPackageBytes === undefined ? [] : [parse(trailPackageBytes)]),
      ...(erosionPackageBytes === undefined
        ? []
        : [parse(erosionPackageBytes)]),
    ],
    manifestSha = await sha256(effectsManifestBytes),
    materials = new Map();
  if (selectedMaterials?.mode === "native-quad-partial")
    for (const [key, value] of selectedMaterials.materials())
      materials.set(key, value);
  for (
    let i = 0;
    i < packages.length && selectedMaterials?.mode !== "native-quad-partial";
    i++
  ) {
    const p = packages[i];
    if (
      p.build !== "16.21.829.8620" ||
      p.protocol !== "20e09df23c66b85e" ||
      p.effectsManifestSha256 !== manifestSha ||
      p.counts.emitters !== p.emitters.length
    )
      throw Error("Unsupported complete-parent GPU build/asset contract");
    for (const prepared of p.emitters) {
      const key = `${prepared.effectId}:${prepared.emitterIndex}`,
        ref = manifest.definitions[prepared.effectId];
      if (
        materials.has(key) ||
        !ref ||
        ref.sha256 !== prepared.sourceDefinitionSha256 ||
        !uint(prepared.emitterIndex) ||
        !Array.isArray(prepared.nativeBlendFactors) ||
        prepared.nativeBlendFactors.length !== 4 ||
        prepared.nativeBlendFactors.some((f) => ![1, 6, 7].includes(f)) ||
        typeof prepared.suppliedDepthTest !== "boolean" ||
        typeof prepared.suppliedDoubleSide !== "boolean" ||
        !Number.isSafeInteger(prepared.suppliedSortPass)
      )
        throw Error("Invalid or ambiguous complete-parent material binding");
      materials.set(key, {
        key,
        prepared,
        primitive: i === 1 ? "trail" : "quad",
      });
    }
  }
  return new ParentRenderFrames(manifest, materials);
}

class ParentRenderFrames {
  #parents = new Map();
  #staged = new WeakSet();
  #revision = 0;
  constructor(manifest, materials) {
    this.manifest = manifest;
    this.materials = materials;
  }
  bindParent(key, effectId, ownership) {
    if (
      key === null ||
      key === undefined ||
      this.#parents.has(key) ||
      !this.manifest.definitions[effectId] ||
      !ownership ||
      !Array.isArray(ownership.actors) ||
      ownership.actors.length > 4096 ||
      !uint(ownership.object) ||
      !uint(ownership.parent)
    )
      throw Error("Invalid or duplicate complete-parent render owner");
    if (
      typeof key === "object" &&
      typeof key.effectId === "string" &&
      key.effectId !== effectId
    )
      throw Error("Complete-parent render root differs from its owned handle");
    const actors = new Map();
    for (const actor of ownership.actors) {
      const kind = WRITERS.get(actor.primitiveVtableRva),
        binding = this.materials.get(`${effectId}:${actor.emitterIndex}`);
      if (
        actor.kind !== "complex" ||
        !uint(actor.emitterIndex) ||
        !kind ||
        !uint(actor.pointer) ||
        actors.has(actor.emitterIndex) ||
        !binding ||
        (binding.primitive === "trail") !==
          (kind === "camera-trail" || kind === "arbitrary-trail")
      )
        throw Error("Unsupported complete-parent actor/material ownership");
      actors.set(actor.emitterIndex, { pointer: actor.pointer, kind, binding });
    }
    this.#parents.set(key, { effectId, actors });
    this.#revision++;
  }
  unbindParent(key) {
    if (!this.#parents.delete(key))
      throw Error("Unowned complete-parent render release");
    this.#revision++;
  }
  stage({ time, camera, parents }) {
    if (
      !Number.isFinite(time) ||
      !camera ||
      !["position", "right", "up", "axis"].every((name) =>
        finiteVector(camera[name], 3),
      ) ||
      !Array.isArray(parents) ||
      parents.length !== this.#parents.size ||
      new Set(parents.map((p) => p.key)).size !== parents.length
    )
      throw Error("Incomplete complete-parent render frame");
    const draws = [];
    for (const p of parents) {
      const owner = this.#parents.get(p.key);
      if (
        !owner ||
        p.time !== Math.fround(time) ||
        (Object.hasOwn(p, "visible") && typeof p.visible !== "boolean")
      )
        throw Error("Complete-parent frame owner/time/visibility differs");
      if (p.visible === false) {
        if (Object.hasOwn(p, "geometry"))
          throw Error("Hidden parent must not supply stale geometry");
        continue;
      }
      if (
        !Array.isArray(p.geometry) ||
        p.geometry.length !== owner.actors.size ||
        new Set(p.geometry.map((g) => g.emitterIndex)).size !==
          p.geometry.length
      )
        throw Error("Complete-parent frame owner/time/actor set differs");
      for (const geometry of p.geometry) {
        const actor = owner.actors.get(geometry.emitterIndex);
        if (
          !actor ||
          geometry.actor !== actor.pointer ||
          geometry.kind !== actor.kind
        )
          throw Error(
            "Complete-parent geometry belongs to another actor/primitive",
          );
        const attributes = parentGeometryAttributes(geometry);
        draws.push({
          key: p.key,
          effectId: owner.effectId,
          emitterIndex: geometry.emitterIndex,
          kind: actor.kind,
          particleCount: geometry.particleCount,
          materialKey: actor.binding.key,
          attributes,
          drawBytes: geometry.draw.slice(),
        });
      }
    }
    const frame = {
      time,
      camera: structuredClone(camera),
      revision: this.#revision,
      draws,
    };
    this.#staged.add(frame);
    return frame;
  }
  assertCurrent(frame) {
    if (!frame || !this.#staged.has(frame) || frame.revision !== this.#revision)
      throw Error("Obsolete complete-parent render frame");
  }
  clear() {
    this.#parents.clear();
    this.#revision++;
  }
}
