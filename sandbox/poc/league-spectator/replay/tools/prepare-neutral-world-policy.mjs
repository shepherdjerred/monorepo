// Static identities/consumer proofs only; no replay event is copied to assets.
import path from "node:path";
import { NEUTRAL_CREATION_PACKAGE_SHA } from "../latest-neutral-creation.mjs";
import { loadNeutralArgumentProof } from "./neutral-argument-corpus.mjs";

const [argumentsArg, skinArg, placementArg, recordsArg, outputArg] =
  process.argv.slice(2);
if (!outputArg || process.argv.length !== 7)
  throw Error(
    "Usage: bun prepare-neutral-world-policy.mjs <factory-arguments> <skin-selection-proof> <placement-proof> <character-record-proof> <output.json>",
  );
const sha = (bytes) =>
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
  inputs = {};
async function read(file) {
  const bytes = await Bun.file(file).bytes();
  inputs[path.resolve(file)] = sha(bytes);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
const argumentInput = await loadNeutralArgumentProof(argumentsArg),
  argumentsProof = await read(argumentsArg),
  skin = await read(skinArg),
  placement = await read(placementArg),
  records = await read(recordsArg);
for (const proof of [
  ...argumentInput.proofs.map((source) => source.proof),
  skin,
  placement,
  records,
]) {
  if (
    proof.build !== "16.21.829.8620" ||
    proof.protocol !== "20e09df23c66b85e" ||
    proof.boundary !== null ||
    proof.decoderImageSha256 !==
      "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7"
  )
    throw Error(
      "Exact complete original neutral consumer observations required",
    );
  for (const [file, expected] of Object.entries(proof.sources))
    if (sha(await Bun.file(file).bytes()) !== expected)
      throw Error("Original neutral consumer source changed: " + file);
}
const argumentSha = inputs[path.resolve(argumentsArg)];
if (
  skin.kind !== "original-empty-skin-meta-selection" ||
  skin.argumentProofSha256 !== argumentSha ||
  skin.selectedMapSkin !== "Default" ||
  placement.kind !== "original-neutral-cold-world-placement" ||
  placement.argumentProofSha256 !== argumentSha ||
  placement.clientKind !== "factory-minion" ||
  !placement.scope.originalMinionTypeRegistrationPoolAndAllocationExecuted ||
  !placement.scope.originalRegistrationAndPositionPrefixExecuted ||
  !placement.scope.nativePositionExactlyMatchesRecordedFactoryPoint ||
  placement.scope.fullFactoryExecuted !== false ||
  placement.scope.acceptedReplayEntities !== false ||
  records.kind !== "original-world-character-record-consumers" ||
  !records.scope.originalReplicationRegistrationCompared ||
  !records.scope.originalCorpseLifetimeGetterExecuted ||
  records.scope.nativeFactoryAccepted !== false
)
  throw Error(
    "Scoped original neutral type/placement/skin/record proof chain required",
  );
const requested = new Map();
for (const row of argumentInput.requests)
  requested.set(`${row.character.toLowerCase()}/${row.skinId}`, row.character);
const bindings = {};
for (const [key, character] of requested) {
  const requestedSkinId = Number(key.slice(key.lastIndexOf("/") + 1)),
    skins = skin.cases.filter(
      (row) =>
        row.character.toLowerCase() === character &&
        row.requestedSkinId === requestedSkinId,
    ),
    definitions = records.cases.filter((row) => row.key === key);
  if (
    skins.length !== 1 ||
    skins[0].resourceSkinId !== requestedSkinId ||
    definitions.length !== 1 ||
    definitions[0].character.toLowerCase() !== character.toLowerCase() ||
    definitions[0].resourceSkinId !== requestedSkinId ||
    definitions[0].reference.toLowerCase() !==
      `Characters/${character}/CharacterRecords/Root`.toLowerCase()
  )
    throw Error(
      "Unresolved original neutral resource skin/CharacterRecord: " + key,
    );
  const definition = definitions[0];
  bindings[key] = {
    character,
    requestedSkinId,
    resourceSkinId: requestedSkinId,
    asset: `neutral/${key}`,
    characterRecords: [definition.reference],
    characterSourceSha256: definition.source.sha256,
    minionFlags: definition.minionFlags,
    replicationSchema: definition.replicationSchema,
    healthBarHeight: definition.healthBarHeight,
    deathTime: definition.deathTime,
    corpseDuration: definition.corpseDuration,
    corpseDurationBits: definition.corpseDurationBits,
  };
}
if (
  Object.keys(bindings).length !== records.cases.length ||
  Object.keys(bindings).length !== skin.cases.length
)
  throw Error("Original neutral assets and consumer proof coverage differ");
const policy = {
  schema: 1,
  kind: "original-default-map11-neutral-candidates",
  build: argumentsProof.build,
  protocol: argumentsProof.protocol,
  mapId: 11,
  mapSkin: "Default",
  argumentProgramSha256: NEUTRAL_CREATION_PACKAGE_SHA,
  nativeClass: "AIMinionClient",
  nativeVtableRva: 0x23013b8,
  positionArgument: "firstVectorArgument",
  resourceSkinPolicy: "original-empty-meta-default-map",
  resourceSkinProofSha256: inputs[path.resolve(skinArg)],
  placementProofSha256: inputs[path.resolve(placementArg)],
  characterRecordProofSha256: inputs[path.resolve(recordsArg)],
  bindings,
  provenance: {
    argumentProofSha256: argumentSha,
    argumentSources: argumentInput.proofs.map((source) => ({
      sha256: source.sha256,
      replaySha256: source.proof.replaySha256,
    })),
    preparerSha256: sha(await Bun.file(import.meta.path).bytes()),
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
  },
  scope: {
    staticBuildAssetsOnly: true,
    containsReplayEvents: false,
    logicalRecordedNetworkIdentityLookup: true,
    nativeFactoryAccepted: false,
    snapshotsCreateEntities: false,
    teamMappingRecovered: false,
    completeCharacterLoaded: false,
    nativeLiveClockBindingVerified: false,
  },
};
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("Neutral proof input changed before publication: " + file);
await Bun.write(outputArg, JSON.stringify(policy, null, 2));
console.log(
  JSON.stringify({
    output: path.resolve(outputArg),
    actors: Object.keys(bindings).length,
    spectatorAdmission: false,
  }),
);
