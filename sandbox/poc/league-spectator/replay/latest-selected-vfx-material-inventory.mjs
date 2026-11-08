// A selected static corpus must retain the fixed original observation program
// and include every selected bound-quad identity at all17 supplied environments.
import { sha256 } from "./structural-comparison.mjs";
import {
  sameDirectCompiledData,
  assertDirectCompiledDataGraph,
} from "./latest-direct-compiled-restore.mjs";
export const APPROVED_NATIVE_MATERIAL_REFERENCE_SHA =
  "cc5546c775c502134e4cd9d292e97bed4e797bbd3bd7d4ab94e74b2cddfee1c5";
const owned = new WeakMap(),
  policy = "selected-complete-native-quad-material-inventory-v1";
const need = (condition, message) => {
  if (!condition) throw Error(message);
};
const parse = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
export async function createSelectedNativeMaterialInventory({
  approvedReferenceBytes,
  materialBytes,
  boundQuadBytes,
  imageBytes,
  profile,
  loadGraph,
  effectIds = null,
}) {
  need(
    approvedReferenceBytes instanceof Uint8Array &&
      materialBytes instanceof Uint8Array &&
      boundQuadBytes instanceof Uint8Array &&
      imageBytes instanceof Uint8Array,
    "Owned selected native material byte spans required",
  );
  need(
    typeof loadGraph === "function",
    "Exact selected native graph loader required",
  );
  need(
    (await sha256(approvedReferenceBytes)) ===
      APPROVED_NATIVE_MATERIAL_REFERENCE_SHA,
    "Fixed original native material algorithm approval required",
  );
  assertDirectCompiledDataGraph(profile);
  need(
    effectIds === null ||
      (Array.isArray(effectIds) &&
        effectIds.every((id) => typeof id === "string") &&
        new Set(effectIds).size === effectIds.length),
    "Explicit unique selected material definition scope required",
  );
  const requested = effectIds === null ? null : new Set(effectIds),
    verified = new Set();
  const approved = parse(approvedReferenceBytes),
    meta = parse(materialBytes),
    bound = parse(boundQuadBytes),
    quadHash = await sha256(boundQuadBytes);
  for (const key of [
    "schema",
    "kind",
    "build",
    "protocol",
    "sliceSha256",
    "decoderImageSha256",
    "sources",
    "entrypoints",
    "scope",
  ])
    need(
      sameDirectCompiledData(meta[key], approved[key]),
      "Selected native material algorithm approval differs: " + key,
    );
  need(
    profile.clientVersion === meta.build &&
      profile.protocolDigest === meta.protocol &&
      profile.decoderImageSha256 === meta.decoderImageSha256 &&
      (await sha256(imageBytes)) === meta.decoderImageSha256 &&
      quadHash === profile.vfxBoundQuadsSha256 &&
      meta.quadPackageSha256 === quadHash &&
      bound.build === meta.build &&
      bound.protocol === meta.protocol &&
      bound.decoderImageSha256 === meta.decoderImageSha256,
    "Selected native material build/quad/image parents differ",
  );
  need(
    Array.isArray(bound.templates) &&
      bound.templates.length > 0 &&
      meta.emitters.length === bound.templates.length &&
      meta.counts.emitters === bound.templates.length &&
      meta.counts.shaderSelections === bound.templates.length * 17,
    "Complete nonempty selected native material corpus required",
  );
  const seen = new Set(),
    environments = approved.emitters[0].probes.map((p) => p.input);
  for (let i = 0; i < bound.templates.length; i++) {
    const ref = bound.templates[i],
      emitter = meta.emitters[i],
      key = `${ref.effectId}:${ref.emitterIndex}`;
    need(
      /^vfx-bound-quad-graphs\/[a-f0-9]{64}\.json$/.test(ref.file),
      "Exact selected native graph path required",
    );
    let defined = emitter.definedObjectMask;
    need(
      Number.isInteger(defined) && defined >= 0 && defined <= 7,
      "Explicit original material pointer predicate mask required",
    );
    if (requested === null || requested.has(ref.effectId)) {
      const graphBytes = await loadGraph(ref.file);
      need(
        graphBytes instanceof Uint8Array &&
          (await sha256(graphBytes)) === ref.sha256,
        "Selected native material complete graph bytes differ",
      );
      const graph = parse(graphBytes),
        object = Uint8Array.fromHex(graph.assetObjectHex),
        view = new DataView(object.buffer);
      need(
        object.length >= 0x238 &&
          graph.effectId === ref.effectId &&
          graph.emitterIndex === ref.emitterIndex &&
          graph.sourceDefinitionSha256 === ref.sourceDefinitionSha256,
        "Selected native graph source identity differs",
      );
      defined = [0x230, 0x48, 0x40].reduce(
        (mask, offset, bit) =>
          mask | (view.getBigUint64(offset, true) !== 0n ? 1 << bit : 0),
        0,
      );
      verified.add(key);
    }
    const expectedEnvironments = environments.map((input, index) =>
      index < 8 ? input : { ...input, resourceMask: defined },
    );
    need(
      !seen.has(key) &&
        emitter.effectId === ref.effectId &&
        emitter.emitterIndex === ref.emitterIndex &&
        emitter.graphSha256 === ref.sha256 &&
        emitter.sourceDefinitionSha256 === ref.sourceDefinitionSha256 &&
        emitter.graphFile === ref.file &&
        emitter.primitiveKind === ref.primitiveKind &&
        emitter.definedObjectMask === defined &&
        sameDirectCompiledData(
          emitter.probes.map((p) => p.input),
          expectedEnvironments,
        ),
      "Exact selected emitter graph and17-environment identity required",
    );
    seen.add(key);
    need(
      emitter.probes.every(
        (p) =>
          Number.isInteger(p.result) &&
          p.result >= 0 &&
          p.result < meta.resultCatalog.length,
      ),
      "Complete original selected material observations required",
    );
  }
  need(
    meta.originalBlocks.length > 0,
    "Original selected material instruction observations required",
  );
  for (const block of meta.originalBlocks)
    need(
      Number.isSafeInteger(block.rva) &&
        Number.isSafeInteger(block.size) &&
        block.rva >= 0 &&
        block.size > 0 &&
        block.rva + block.size <= imageBytes.length &&
        (await sha256(
          imageBytes.subarray(block.rva, block.rva + block.size),
        )) === block.sha256,
      "Selected native material instructions differ from approved image",
    );
  const token = Object.freeze({ policy, emitters: bound.templates.length });
  owned.set(token, {
    materialSha256: await sha256(materialBytes),
    profile: structuredClone(profile),
    emitters: bound.templates.length,
    verified,
  });
  return token;
}
export function assertSelectedNativeMaterialEmitter(
  token,
  effectId,
  emitterIndex,
) {
  need(
    owned.get(token)?.verified.has(`${effectId}:${emitterIndex}`),
    "Selected native material definition was not source-bound",
  );
}
export function selectedNativeMaterialEmitterCount(
  token,
  { materialSha256, profile },
) {
  const data = owned.get(token);
  need(
    data &&
      data.materialSha256 === materialSha256 &&
      sameDirectCompiledData(data.profile, profile),
    "Owned exact selected native material inventory required",
  );
  return data.emitters;
}
