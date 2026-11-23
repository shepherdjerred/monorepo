// Build-specific resource requests after an independent native skin-selection
// proof. Decoded match IDs/times stay in the private evidence, outside assets.
import { resolve } from "node:path";
import { loadNeutralArgumentProof } from "./neutral-argument-corpus.mjs";
const [argumentsArg, selectionArg, inputArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun create-neutral-actor-request.mjs <native-arguments.json> <native-skin-selection.json> <native-meta-input.json> <output.json>",
  );
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const argumentBytes = await Bun.file(argumentsArg).bytes(),
  selectionBytes = await Bun.file(selectionArg).bytes(),
  inputBytes = await Bun.file(inputArg).bytes();
const argumentInput = await loadNeutralArgumentProof(argumentsArg),
  args = argumentInput.document,
  selection = decode(selectionBytes),
  input = decode(inputBytes);
for (const value of [args, selection, input])
  if (value.build !== "16.21.829.8620" || value.protocol !== "20e09df23c66b85e")
    throw Error("Exact original neutral build/protocol required");
if (
  selection.kind !== "original-empty-skin-meta-selection" ||
  input.kind !== "original-native-skin-meta-field-input" ||
  selection.boundary !== null ||
  selection.argumentProofSha256 !== sha(argumentBytes) ||
  selection.inputSha256 !== sha(inputBytes) ||
  selection.selectedMapSkin !== "Default" ||
  !selection.scope.originalTypedMetadataConstructed ||
  !selection.scope.emptyRemapAndOffsetModeBranchInvariance ||
  !selection.scope.defaultMapFallbackTableProvenEmpty ||
  selection.scope.completeResourceResolverExecuted ||
  selection.scope.dynamicMapVariantsAdmitted
)
  throw Error(
    "Complete matching original empty-metadata/default-map skin selection proof required",
  );
for (const proof of [
  ...argumentInput.proofs.map((source) => source.proof),
  selection,
])
  for (const [file, digest] of Object.entries(proof.sources))
    if (sha(await Bun.file(file).bytes()) !== digest)
      throw Error("Original native proof source changed: " + file);
const requested = new Set(
    argumentInput.requests.map((row) => `${row.character}/${row.skinId}`),
  ),
  seen = new Set(),
  actors = [];
for (const entry of selection.cases) {
  const key = `${entry.character.toLowerCase()}/${entry.requestedSkinId}`;
  if (
    !requested.has(key) ||
    seen.has(key) ||
    !Number.isSafeInteger(entry.resourceSkinId) ||
    entry.resourceSkinId < 0 ||
    entry.resourceSkinId > 10000 ||
    entry.remainingModeBranchResults.some((id) => id !== entry.resourceSkinId)
  )
    throw Error("Unique original neutral resource selection required");
  seen.add(key);
  actors.push({
    character: entry.character,
    skinId: entry.resourceSkinId,
    role: "world",
    characterRecords: [`Characters/${entry.character}/CharacterRecords/Root`],
    wad: "DATA/FINAL/Maps/Shipping/Map11.wad.client",
  });
}
if (seen.size !== requested.size)
  throw Error("Native skin selection omitted a requested neutral resource");
actors.sort((a, b) =>
  `${a.character}/${a.skinId}`.localeCompare(`${b.character}/${b.skinId}`),
);
const request = {
  schema: 1,
  build: args.build,
  protocol: args.protocol,
  actors,
  provenance: {
    producerSha256: sha(await Bun.file(import.meta.path).bytes()),
    arguments: { path: resolve(argumentsArg), sha256: sha(argumentBytes) },
    argumentSources: argumentInput.proofs.map((source) => ({
      sha256: source.sha256,
      replaySha256: source.proof.replaySha256,
    })),
    argumentCorpusReaderSha256: sha(
      await Bun.file(
        new URL("neutral-argument-corpus.mjs", import.meta.url),
      ).bytes(),
    ),
    argumentCorpusSchemaSha256: sha(
      await Bun.file(
        new URL("neutral-argument-corpus.schema.json", import.meta.url),
      ).bytes(),
    ),
    selection: { path: resolve(selectionArg), sha256: sha(selectionBytes) },
    metadataInput: { path: resolve(inputArg), sha256: sha(inputBytes) },
    selectedMapSkin: "Default",
    skinSelection:
      "Original empty metadata and Default-map fallback table; both original mode branches preserve requested skin",
    scope: {
      fullResourceResolverExecuted: false,
      dynamicMapVariantsAdmitted: false,
      nativeEntityCreationAdmitted: false,
      nativeSpectatorEquivalent: false,
    },
  },
};
await Bun.write(outputArg, JSON.stringify(request, null, 2));
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    actors: actors.length,
    sha256: sha(await Bun.file(outputArg).bytes()),
  }),
);
