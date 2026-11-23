// Complete original emitter field spans for a selected archived FX package.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { sceneAnimationFilePath } from "../scene-animation-authority.mjs";

const [sourceArg, effectsArg, inventoryArg, cacheArg] = process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-vfx-field-inputs.mjs <approved-source-cache> <matching-effects> <original-fx-inventory> <archive-cache>",
  );
const { out } = await createStaticPreparationOutput(sourceArg, cacheArg, {
    prefix: "vfx-fields-",
    directory: "vfx-fields",
  }),
  roots = {
    effects: path.resolve(effectsArg),
    inventory: path.resolve(inventoryArg),
  },
  manifests = {},
  selected = {},
  authorityBytes = {},
  consumed = new Map(),
  written = new Map(),
  compilerSources = {};
for (const file of [
  "prepare-scene-vfx-field-inputs.mjs",
  "archived-actor-sources.mjs",
  "exact-map-bin.mjs",
  "map-scene-assets.mjs",
  "map-scene-output.mjs",
  "../scene-animation-authority.mjs",
])
  compilerSources[file] = sha(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
for (const [authority, root] of Object.entries(roots)) {
  authorityBytes[authority] = await Bun.file(
    path.join(root, "manifest.json"),
  ).bytes();
  manifests[authority] = JSON.parse(
    new TextDecoder().decode(authorityBytes[authority]),
  );
  selected[authority] = new Map();
  for (const entry of manifests[authority].files) {
    const file = entry.path ?? entry.file;
    sceneAnimationFilePath(file);
    if (selected[authority].has(file))
      throw Error("Duplicate original VFX source file");
    selected[authority].set(file, entry);
  }
}
if (
  manifests.effects.kind !== "archived-map11-partial-effects" ||
  manifests.effects.sourceInventorySha256 !== sha(authorityBytes.inventory) ||
  manifests.inventory.kind !== "archived-map11-fx-source-inventory" ||
  manifests.effects.sceneManifestSha256 !==
    manifests.inventory.sceneManifestSha256
)
  throw Error("Matching original archived FX inputs required");
async function read(authority, file) {
  sceneAnimationFilePath(file);
  const entry = selected[authority].get(file);
  if (!entry) throw Error("Unselected original VFX source");
  const bytes = await Bun.file(path.join(roots[authority], file)).bytes();
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256)
    throw Error("Original VFX source changed");
  consumed.set(`${authority}:${file}`, {
    authority,
    file,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  return bytes;
}
async function write(file, bytes) {
  if (written.has(file)) return;
  await Bun.write(path.join(out, file), bytes);
  written.set(file, { file, bytes: bytes.length, sha256: sha(bytes) });
}
const bins = new Map();
for (const file of selected.inventory.keys())
  if (/^bins\/\d+\.typed\.json$/.test(file)) {
    const typed = JSON.parse(
        new TextDecoder().decode(await read("inventory", file)),
      ),
      raw = await read("inventory", file.replace(".typed.json", ".bin"));
    if (sha(raw) !== typed.sourceSha256)
      throw Error("Original VFX BIN identity differs");
    bins.set(typed.sourceSha256, {
      raw,
      tree: readExactMapBin(raw, manifests.effects.build, {
        captureFieldSpans: true,
      }),
    });
  }
const emitters = [],
  declarations = [];
for (const [effectId, index] of Object.entries(manifests.effects.definitions)) {
  const bytes = await read("effects", index.file),
    definition = JSON.parse(new TextDecoder().decode(bytes));
  if (
    sha(bytes) !== index.sha256 ||
    definition.actor !== index.actor ||
    definition.definition.__type !== index.class
  )
    throw Error("Selected VFX definition index differs");
  if (index.class !== "VfxSystemDefinitionData") {
    declarations.push({
      effectId,
      class: index.class,
      status: "non-vfx-linked-definition",
    });
    continue;
  }
  const candidates = definition.sourceBins.map((entry) => {
    const bin = bins.get(entry.sourceSha256),
      node = bin?.tree.objects.find(
        (value) => value.pathHash === definition.id,
      );
    if (!node || node.classHash !== mapBinHash("VfxSystemDefinitionData"))
      throw Error("Original VFX root object is absent");
    return { source: entry, bin, node };
  });
  if (!candidates.length) throw Error("Original VFX object owner required");
  const first = candidates[0];
  const identity = (node) =>
    JSON.stringify({ classHash: node.classHash, fields: node.fields });
  if (
    candidates.some(
      (candidate) => identity(candidate.node) !== identity(first.node),
    )
  )
    throw Error("Original VFX owner precedence is unresolved");
  const binFile = `bin-${first.source.sourceSha256}.bin`;
  await write(binFile, first.bin.raw);
  for (const [kind, fieldName, expectedCount] of [
    ["complex", "complexEmitterDefinitionData", index.complexEmitters],
    ["simple", "simpleEmitterDefinitionData", index.simpleEmitters],
  ]) {
    const property = first.node.fields[mapBinHash(fieldName)];
    if (!property) {
      if (expectedCount) throw Error("Original VFX emitter list disappeared");
      continue;
    }
    if (
      !["Container", "UnorderedContainer"].includes(property.type) ||
      property.elements.length !== expectedCount
    )
      throw Error("Original VFX emitter list shape differs");
    property.elements.forEach((emitter, emitterIndex) => {
      if (!["Struct", "Embedded"].includes(emitter.type))
        throw Error("Original VFX emitter object required");
      emitters.push({
        effectId,
        emitterIndex,
        kind,
        classHash: emitter.classHash,
        definitionSha256: index.sha256,
        binFile,
        binSha256: first.source.sourceSha256,
        ownerPathHash: first.node.pathHash,
        originalOwners: definition.sourceBins,
        fields: (emitter.fieldSpans ?? []).map((span) => ({
          fieldHash: span.fieldHash,
          offset: span.offset,
          bytes: span.bytes,
          sha256: sha(
            first.bin.raw.subarray(span.offset, span.offset + span.bytes),
          ),
        })),
      });
    });
  }
}
const request = {
    schema: 1,
    kind: "original-scene-vfx-field-inputs",
    build: manifests.effects.build,
    protocol: manifests.effects.protocol,
    sceneManifestSha256: manifests.effects.sceneManifestSha256,
    effectsManifestSha256: sha(authorityBytes.effects),
    inventoryManifestSha256: sha(authorityBytes.inventory),
    emitters,
    declarations,
    compilerSources,
    consumedInputs: [...consumed.values()],
    nativeSpectatorAdmitted: false,
  },
  encoded = new TextEncoder().encode(JSON.stringify(request));
await write("input.json", encoded);
for (const entry of consumed.values()) await read(entry.authority, entry.file);
for (const [file, digest] of Object.entries(compilerSources))
  if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
    throw Error("Original VFX input compiler changed");
for (const [authority, root] of Object.entries(roots))
  if (
    sha(await Bun.file(path.join(root, "manifest.json")).bytes()) !==
    sha(authorityBytes[authority])
  )
    throw Error("Original VFX input authority changed");
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    { ...request, input: "input.json", files: [...written.values()] },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    emitters: emitters.length,
    complexEmitters: emitters.filter((entry) => entry.kind === "complex")
      .length,
    simpleEmitters: emitters.filter((entry) => entry.kind === "simple").length,
    bins: written.size - 1,
    nativeSpectatorAdmitted: false,
  }),
);
