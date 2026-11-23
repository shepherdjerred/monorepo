// Verify the two format labels against original source bytes, retaining curve
// values unchanged. This establishes naming, not native curve or FX admission.
import { resolve, join } from "node:path";
import { strict as assert } from "node:assert";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  ACTOR_META_SOURCE_SHA256,
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
import {
  canonicalDirectEmitterColor,
  DIRECT_EMITTER_COLOR_FIELD_HASH,
} from "../latest-direct-emitter-color-field.mjs";
import {
  canonicalDirectSystemObjectPath,
  DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH,
} from "../latest-direct-system-object-path-field.mjs";
const [approvedArg, inventoryArg, report] = process.argv.slice(2);
if (!report)
  throw Error(
    "Usage: bun inspect-emitter-color-field.mjs <approved-source-cache> <archived-fx-inventory> <output.json>",
  );
const approved = resolve(approvedArg),
  root = resolve(inventoryArg),
  inputs = {},
  read = async (file) => {
    const bytes = await Bun.file(file).bytes();
    inputs[resolve(file)] = sha(bytes);
    return bytes;
  },
  decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
await captureDirectSourceInputs([import.meta.path], read);
const metadata = await read(
  join(
    approved,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
);
assert.equal(sha(metadata), ACTOR_META_SOURCE_SHA256);
const names = readActorMetaNames(new TextDecoder().decode(metadata)),
  emitterClass = mapBinHash("VfxEmitterDefinitionData"),
  valueClass = mapBinHash("ValueColor"),
  legacy = decode(
    await read(join(approved, "public/latest-effects/manifest.json")),
  ),
  dictionaryBytes = await read(join(approved, "vfx/hashes.binfields.txt"));
assert.equal(sha(dictionaryBytes), legacy.toolchain.dictionaries.binfields);
const dictionary = new TextDecoder()
  .decode(dictionaryBytes)
  .split(/\r?\n/)
  .filter((line) => line.startsWith(`${DIRECT_EMITTER_COLOR_FIELD_HASH} `));
assert.deepEqual(dictionary, [`${DIRECT_EMITTER_COLOR_FIELD_HASH} Color`]);
assert.equal(
  names.fieldName(emitterClass, DIRECT_EMITTER_COLOR_FIELD_HASH),
  "color",
);
assert.equal(names.className(valueClass), "ValueColor");
assert.equal(mapBinHash("Color"), DIRECT_EMITTER_COLOR_FIELD_HASH);
assert.equal(mapBinHash("objectPath"), DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH);
assert.deepEqual(
  new TextDecoder()
    .decode(dictionaryBytes)
    .split(/\r?\n/)
    .filter((line) =>
      line.startsWith(`${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH} `),
    ),
  [`${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH} objectPath`],
);
const systemClass = mapBinHash("VfxSystemDefinitionData");
assert.equal(
  names.fieldName(systemClass, DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH),
  `{${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH}}`,
);
const inventory = decode(await read(join(root, "manifest.json")));
assert.equal(inventory.kind, "archived-map11-fx-source-inventory");
const declarations = new Map(inventory.files.map((ref) => [ref.file, ref]));
async function selected(file) {
  const ref = declarations.get(file);
  assert(ref, `Unselected original color input: ${file}`);
  const bytes = await read(join(root, file));
  assert.equal(bytes.length, ref.bytes);
  assert.equal(sha(bytes), ref.sha256);
  return bytes;
}
let originalFields = 0,
  normalizedFields = 0,
  bins = 0,
  originalSystemPaths = 0,
  normalizedSystemPaths = 0,
  foreignSystemPathHashes = 0;
const values = [];
function visitTyped(value) {
  if (!value || typeof value !== "object") return;
  if (
    value.classHash === systemClass &&
    value.fields &&
    Object.hasOwn(value.fields, DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH)
  ) {
    const field = value.fields[DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH];
    assert.equal(field.type, "Hash");
    originalSystemPaths++;
    if (value.pathHash && field.value !== Number.parseInt(value.pathHash, 16))
      foreignSystemPathHashes++;
  }
  if (
    value.classHash === emitterClass &&
    value.fields &&
    Object.hasOwn(value.fields, DIRECT_EMITTER_COLOR_FIELD_HASH)
  ) {
    const field = value.fields[DIRECT_EMITTER_COLOR_FIELD_HASH];
    assert.equal(field.type, "Embedded");
    assert.equal(field.classHash, valueClass);
    originalFields++;
  }
  for (const child of Object.values(value)) visitTyped(child);
}
function visitNormalized(value) {
  if (!value || typeof value !== "object") return;
  if (
    value.__type === "VfxSystemDefinitionData" &&
    Object.hasOwn(value, `{${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH}}`)
  ) {
    const projected = canonicalDirectSystemObjectPath(value);
    assert.equal(
      projected.objectPath,
      value[`{${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH}}`],
    );
    assert.equal(
      Object.hasOwn(projected, `{${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH}}`),
      false,
    );
    assert.equal(
      Object.hasOwn(value, `{${DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH}}`),
      true,
    );
    normalizedSystemPaths++;
  }
  if (
    value.__type === "VfxEmitterDefinitionData" &&
    Object.hasOwn(value, "color")
  ) {
    const projected = canonicalDirectEmitterColor(value);
    assert.equal(projected.Color, value.color);
    assert.equal(projected.Color.__type, "ValueColor");
    assert.equal(Object.hasOwn(projected, "color"), false);
    assert.equal(Object.hasOwn(value, "color"), true);
    values.push(sha(new TextEncoder().encode(JSON.stringify(value.color))));
    normalizedFields++;
  }
  for (const child of Object.values(value)) visitNormalized(child);
}
for (const file of declarations.keys()) {
  if (!/^bins\/\d+\.typed\.json$/.test(file)) continue;
  const typed = decode(await selected(file)),
    raw = await selected(file.replace(".typed.json", ".bin"));
  assert.equal(sha(raw), typed.sourceSha256);
  const reread = readExactMapBin(raw, inventory.build);
  assert.deepEqual(reread, typed);
  visitTyped(reread);
  visitNormalized(normalizeActorBin(reread, names));
  bins++;
}
assert(originalFields > 0);
assert.equal(normalizedFields, originalFields);
assert(originalSystemPaths > 0);
assert.equal(normalizedSystemPaths, originalSystemPaths);
for (const [file, digest] of Object.entries(inputs))
  assert.equal(
    sha(await Bun.file(file).bytes()),
    digest,
    `Color naming proof source drift: ${file}`,
  );
const summary = {
  bins,
  originalFields,
  normalizedFields,
  fieldHash: DIRECT_EMITTER_COLOR_FIELD_HASH,
  emitterClass,
  valueClass,
  uniqueAuthoredValues: new Set(values).size,
  systemPathFieldHash: DIRECT_SYSTEM_OBJECT_PATH_FIELD_HASH,
  originalSystemPaths,
  normalizedSystemPaths,
  foreignSystemPathHashes,
};
await Bun.write(
  report,
  JSON.stringify({
    schema: 1,
    kind: "original-emitter-color-field-name-control",
    summary,
    inputs,
    scope: {
      originalRawBinRead: true,
      typedValuePreserved: true,
      nativeCurveMathNewlyEstablished: false,
      effectSimulationAdmissionEstablished: false,
    },
  }),
);
console.log(JSON.stringify({ output: report, ...summary, sourceDrift: 0 }));
