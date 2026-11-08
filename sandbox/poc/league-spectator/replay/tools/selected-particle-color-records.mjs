// Static preparation only. The approved slot-1 native prefix is replayed as a
// deterministic byte contract against complete selected source/graph inputs.
import {
  sameDirectCompiledData,
  assertDirectCompiledDataGraph,
} from "../latest-direct-compiled-restore.mjs";
import { resolve, sep } from "node:path";
import { deriveSelectedParticleColorEntry } from "../latest-selected-particle-color-record.mjs";
export { deriveSelectedParticleColorEntry } from "../latest-selected-particle-color-record.mjs";
const need = (condition, message) => {
  if (!condition) throw Error(message);
};
export async function validateSelectedParticleColorRecords({
  meta,
  approved,
  assets,
  raw: readRaw,
  sha,
}) {
  assertDirectCompiledDataGraph(meta);
  assertDirectCompiledDataGraph(approved);
  const expectedInputs = {},
    assetRoot = resolve(assets),
    raw = async (path) => {
      path = resolve(path);
      need(
        path.startsWith(assetRoot + sep),
        "Native selected color input escaped its static root",
      );
      const bytes = await readRaw(path),
        hash = sha(bytes);
      need(
        !expectedInputs[path] || expectedInputs[path] === hash,
        "Native selected color source changed during validation",
      );
      expectedInputs[path] = hash;
      return bytes;
    };
  need(
    sameDirectCompiledData(
      Object.keys(meta).sort(),
      Object.keys(approved).sort(),
    ),
    "Exact native color record package fields required",
  );
  for (const key of [
    "schema",
    "kind",
    "build",
    "protocol",
    "sources",
    "decoderImageSha256",
    "sourceBlocks",
    "scope",
  ])
    need(
      sameDirectCompiledData(meta[key], approved[key]),
      "Selected color native algorithm approval differs: " + key,
    );
  const read = async (path) =>
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(await raw(path)),
      ),
    profile = await read(`${assets}/decoder-16.21-macos/profile.json`),
    effects = await read(`${assets}/latest-effects/manifest.json`),
    quadBytes = await raw(`${assets}/decoder-16.21-macos/vfx-bound-quads.json`),
    quads = JSON.parse(new TextDecoder().decode(quadBytes)),
    trails = await read(`${assets}/latest-trail-particles/package.json`);
  need(
    sha(await raw(`${assets}/decoder-16.21-macos/image.bin`)) ===
      meta.decoderImageSha256,
    "Selected original color image differs",
  );
  need(
    sha(quadBytes) === profile.vfxBoundQuadsSha256 &&
      profile.clientVersion === meta.build &&
      profile.protocolDigest === meta.protocol &&
      profile.decoderImageSha256 === meta.decoderImageSha256 &&
      [effects, quads, trails].every(
        (m) => m.build === meta.build && m.protocol === meta.protocol,
      ) &&
      trails.vfxBoundQuadsSha256 === profile.vfxBoundQuadsSha256,
    "Selected color source/profile parents differ",
  );
  const records = new Map(),
    expected = [];
  for (const [directory, collection] of [
    [`${assets}/decoder-16.21-macos`, quads],
    [`${assets}/latest-trail-particles`, trails],
  ])
    for (const reference of collection.templates) {
      const definition = effects.definitions[reference.effectId];
      need(
        definition && definition.sha256 === reference.sourceDefinitionSha256,
        "Selected color source definition identity differs",
      );
      if (!records.has(reference.effectId)) {
        const bytes = await raw(`${assets}/latest-effects/${definition.file}`);
        need(
          sha(bytes) === definition.sha256,
          "Selected color original definition bytes changed",
        );
        records.set(
          reference.effectId,
          JSON.parse(new TextDecoder().decode(bytes)),
        );
      }
      const emitter = records.get(reference.effectId).definition
        .complexEmitterDefinitionData[reference.emitterIndex];
      need(emitter, "Selected color source emitter missing");
      if (!emitter.particleColorTexture) continue;
      const bytes = await raw(`${directory}/${reference.file}`);
      need(
        sha(bytes) === reference.sha256,
        "Selected color complete graph changed",
      );
      const graph = JSON.parse(new TextDecoder().decode(bytes));
      need(
        graph.effectId === reference.effectId &&
          graph.emitterIndex === reference.emitterIndex &&
          graph.sourceDefinitionSha256 === reference.sourceDefinitionSha256 &&
          graph.primitiveKind === reference.primitiveKind,
        "Selected color graph source identity differs",
      );
      const asset = effects.assets[emitter.particleColorTexture.toLowerCase()],
        entry = deriveSelectedParticleColorEntry({
          reference,
          graph,
          emitter,
          asset,
        });
      need(
        sha(await raw(`${assets}/latest-effects/${asset.file}`)) ===
          asset.sha256,
        "Selected color texture bytes changed",
      );
      expected.push(entry);
    }
  need(
    expected.length > 0 && sameDirectCompiledData(expected, meta.entries),
    "Native-derived selected color record inventory differs from exact serialized inputs",
  );
  need(
    sameDirectCompiledData(expectedInputs, meta.inputs),
    "Complete original selected color observation input inventory required",
  );
  const counts = {
    emitters: expected.length,
    uniqueTextures: new Set(expected.map((e) => e.asset.sha256)).size,
    quadEmitters: expected.filter((e) => e.primitiveKind !== "camera-trail")
      .length,
    trailEmitters: expected.filter((e) => e.primitiveKind === "camera-trail")
      .length,
  };
  need(
    sameDirectCompiledData(counts, meta.counts),
    "Complete selected color counts differ",
  );
  return {
    entries: expected.length,
    serializedSamplerBytesVerified: true,
    authoredStringsVerified: true,
    completeInventoryVerified: true,
  };
}
