// Diagnostic comparison; never a per-match runtime registry input.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import {
  compileCharacterContextResourceNames,
  bindSuppliedCharacterContextResource,
} from "../latest-character-context-resources.mjs";
import { projectSpellResourcePublication } from "../latest-spell-resource-publication.mjs";
import { lookupNativeResourceRows } from "../latest-map-effect-resources.mjs";

const cache = resolve(process.argv[2] ?? ".cache/replay-spike"),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error(`Input changed: ${path}`);
  inputs[path] = digest;
  return bytes;
}
const image = await raw(`${cache}/public/decoder-16.21-macos/image.bin`);
async function original(name, kind) {
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      await raw(`${cache}/research/${name}.json`),
    ),
  );
  if (
    data.kind !== kind ||
    data.build !== "16.21.829.8620" ||
    data.protocol !== "20e09df23c66b85e" ||
    data.decoderImageSha256 !== (await sha256(image)) ||
    data.scope.actualEffectsActivated !== false
  )
    throw Error("Exact original static producer controls required");
  for (const [path, hash] of Object.entries(data.inputs))
    if ((await sha256(await raw(path))) !== hash)
      throw Error(`Stale original input: ${path}`);
  for (const block of [
    ...data.originalBlocks,
    ...(data.staticProducerBlocks ?? []),
  ])
    if (
      (await sha256(image.subarray(block.rva, block.rva + block.size))) !==
      block.sha256
    )
      throw Error("Original producer instruction bytes differ");
  return data;
}
const context = await original(
  "character-context-resources-native",
  "original-character-context-resource-controls",
);
if (
  context.publicationTrace.events.length !== 1 ||
  context.publicationTrace.events[0].kind !==
    "character-context-registry-store-completed" ||
  context.publicationTrace.events[0].identity !==
    context.cases[0].contextIdentity ||
  context.publicationTrace.events[0].name.ascii !== context.cases[0].name ||
  context.publicationTrace.events[0].namespace.ascii !==
    context.cases[0].namespace ||
  context.publicationTrace.scope.completeActualReplayStartupEstablished !==
    false
)
  throw Error("Original bounded character publication trace differs");
for (const expected of context.cases) {
  const actual = compileCharacterContextResourceNames(
    expected.name,
    expected.skinId,
    expected.namespace,
  );
  for (const key of [
    "contextIdentity",
    "resourceName",
    "resourceIdentity",
    "fileCandidates",
  ])
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key]))
      throw Error(`Original context ${key} differs`);
}
const names = compileCharacterContextResourceNames(
  context.cases[0].name,
  0,
  context.cases[0].namespace,
);
for (const expected of context.bindings) {
  const actual = bindSuppliedCharacterContextResource(names, {
    status: "supplied-original-typed-resource-query",
    resourceIdentity: context.loadedResourceIdentity,
    found: expected.found,
    typeHash: expected.typeHash,
    rows: expected.rows,
  });
  if (
    (actual.status === "supplied-character-context-resolver") !==
      expected.accepted ||
    actual.originalGetterRva !== expected.getterRva ||
    actual.loadAttemptCompleted !== expected.loadAttemptCompleted ||
    JSON.stringify(actual.rows) !== JSON.stringify(expected.rows)
  )
    throw Error("Original typed context assignment/getter differs");
}
for (const key of context.requestedMissingKeys)
  if (lookupNativeResourceRows(context.rows, key) !== undefined)
    throw Error(
      "Recorded global request unexpectedly resolved in HealthRelic context",
    );
const spell = await original(
  "spell-resource-publication-native",
  "original-spell-global-resource-publication-controls",
);
if (
  spell.sourceField.ownerTypeHash !== 0x43368569 ||
  spell.sourceField.fieldHash !== 0x92a53e77 ||
  spell.sourceField.property.offset !== 0x638 ||
  spell.publicationTrace.events.length !== 13 ||
  spell.publicationTrace.events.some((event, i) => event.sequence !== i) ||
  spell.publicationTrace.scope.completeActualReplayStartupEstablished !== false
)
  throw Error("Original spell producer metadata/ordered trace differs");
const maps = new Map(spell.maps.map((map) => [map.id, map.rows]));
let state = { rows: [], sources: [], componentPublished: false };
for (const expected of spell.cases) {
  state = projectSpellResourcePublication(
    state,
    expected.sourceIds.map((id) => ({
      id,
      status: "supplied-resolved-resource-link",
      rows: maps.get(id),
    })),
    expected.sourceEventId,
  );
  if (
    state.componentPublished !== expected.componentPublished ||
    JSON.stringify(state.rows) !== JSON.stringify(expected.rows)
  )
    throw Error("Original ordered spell postload/publication differs");
}
for (const query of spell.queries) {
  const result = lookupNativeResourceRows(state.rows, query.key);
  if ((result !== undefined) !== query.found || (result ?? 0) !== query.value)
    throw Error("Original global0 null-presence query differs");
}
for (const path of [
  import.meta.path,
  "../latest-character-context-resources.mjs",
  "../latest-spell-resource-publication.mjs",
  "../latest-effect-contexts.mjs",
  "../latest-map-effect-resources.mjs",
  "../structural-comparison.mjs",
])
  await raw(path.startsWith("..") ? resolve(import.meta.dir, path) : path);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error(`Input drift: ${path}`);
const output = `${cache}/research/resource-publication-kernels-comparison.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "resource-publication-kernel-comparison",
      inputs,
      contextNameCases: context.cases.length,
      typedContextBindings: context.bindings.length,
      orderedSpellProducerCases: spell.cases.length,
      globalPresenceQueries: spell.queries.length,
      mismatches: [],
      omissions: state.omissions,
      scope: {
        sharedStaticProducerKernels: true,
        actualStartupRegistryRecovered: false,
        actualGlobal0HistoryRecovered: false,
        actualResourcesActivated: false,
        renderedCoverage: false,
        runtimePlaybackInput: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    contextNameCases: context.cases.length,
    typedContextBindings: context.bindings.length,
    orderedSpellProducerCases: spell.cases.length,
    globalPresenceQueries: spell.queries.length,
    inputFingerprintsVerified: Object.keys(inputs).length,
    mismatches: 0,
  }),
);
