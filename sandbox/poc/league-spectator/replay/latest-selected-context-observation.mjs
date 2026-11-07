// These approve a build/program, not a lineup's resource manifest or data rows.
import { sha256 } from "./structural-comparison.mjs";
import {
  assertLatestStaticCatalogSelection,
  STATIC_CATALOG_DECODER_IMAGE_SHA256,
} from "./latest-static-catalog.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
const PREPARER_SHA =
  "a0446692f87fc3e32ff615ff9d33ff74d46a157106662be920eb03e243a919e9";
const NATIVE_SOURCES_SHA =
  "cd435bdc0e3ec2b4e470f84dae962b2a48e35aecc963daebd74bf411275ee4ba";
const IDENTITY = {
  seedText: "[Character]",
  multiplier: 0x1003f,
  order: ["name", "skinUnsignedDecimal", "namespace"],
  hashRva: 0x1442120,
  appendRva: 0x14371c0,
  constructorPrefix: [0x351910, 0x3519e7],
  identityFragment: [0x351af4, 0x351b46],
  registryLookupRva: 0x354280,
};
const NATIVE_SCOPE = {
  originalConstructorPrefix: true,
  originalIdentityFragment: true,
  decimalSkinTextSuppliedAndCFormatterCompared: true,
  originalRegistryInsertionAndLookup: true,
  assetLoadingExecuted: false,
  resourcePrecedenceExecuted: false,
  matchCreationExecuted: false,
  browserExecuted: false,
  referenceCompared: false,
};
export async function assertLatestSelectedContextObservation({
  selection,
  profile,
  image,
  packageBytes,
  metadata,
}) {
  assertLatestStaticCatalogSelection(selection);
  assertDirectCompiledDataGraph(profile);
  assertDirectCompiledDataGraph(metadata);
  if (!sameDirectCompiledData(selection.profile(), profile))
    throw Error("Selected context build profile differs");
  await selection.assertRole("effectContexts", packageBytes);
  if (
    (image !== undefined &&
      (!(image instanceof Uint8Array) ||
        (await sha256(image)) !== STATIC_CATALOG_DECODER_IMAGE_SHA256)) ||
    profile.decoderImageSha256 !== STATIC_CATALOG_DECODER_IMAGE_SHA256
  )
    throw Error("Selected context requires the approved original native image");
  const bytes = await selection.readRole("effectContextsProof"),
    proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  assertDirectCompiledDataGraph(proof);
  if (
    proof.schema !== 1 ||
    proof.kind !== "native-character-effect-context-observations" ||
    proof.build !== profile.clientVersion ||
    proof.protocol !== profile.protocolDigest ||
    proof.decoderImageSha256 !== STATIC_CATALOG_DECODER_IMAGE_SHA256 ||
    proof.effectsManifestSha256 !== metadata.effectsManifestSha256 ||
    metadata.observationSha256 !== (await sha256(bytes)) ||
    metadata.preparerSha256 !== PREPARER_SHA ||
    !sameDirectCompiledData(metadata.identity, IDENTITY) ||
    !sameDirectCompiledData(proof.scope, NATIVE_SCOPE) ||
    !sameDirectCompiledData(metadata.sourceBlocks, proof.originalBlocks)
  )
    throw Error(
      "Selected context original observation/program approval differs",
    );
  const sources = Object.entries(proof.sources ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (
    (await sha256(new TextEncoder().encode(JSON.stringify(sources)))) !==
    NATIVE_SOURCES_SHA
  )
    throw Error("Selected context native producer sources are unapproved");
  if (
    !Array.isArray(proof.contexts) ||
    proof.counts?.contexts !== metadata.contexts.length ||
    proof.contexts.length !== metadata.contexts.length ||
    proof.boundaries?.length !== 9 ||
    proof.counts.boundaryCases !== 9
  )
    throw Error("Complete original context observation inventory required");
  const actual = proof.contexts.map((row) => ({
      actorKey: row.actorKey,
      name: row.name,
      skinId: row.skinId,
      namespace: row.namespace,
      identity: row.identity,
    })),
    declared = metadata.contexts.map(
      ({ actorKey, name, skinId, namespace, identity }) => ({
        actorKey,
        name,
        skinId,
        namespace,
        identity,
      }),
    );
  if (!sameDirectCompiledData(actual, declared))
    throw Error("Selected context observation rows differ from prepared data");
  const blocks = proof.originalBlocks,
    seen = new Set();
  const evidence = await selection.verifyNativeImageBlocks(blocks);
  for (const block of blocks) {
    if (
      !Number.isSafeInteger(block.rva) ||
      !Number.isSafeInteger(block.size) ||
      block.rva < 0 ||
      block.size <= 0 ||
      block.rva + block.size > evidence.imageBytes ||
      seen.has(block.rva)
    )
      throw Error("Selected context original instruction block differs");
    seen.add(block.rva);
  }
  for (const entry of [
    IDENTITY.hashRva,
    IDENTITY.appendRva,
    IDENTITY.constructorPrefix[0],
    IDENTITY.identityFragment[0],
    IDENTITY.registryLookupRva,
  ])
    if (
      !blocks.some(
        (block) => block.rva <= entry && entry < block.rva + block.size,
      )
    )
      throw Error("Selected context original program entry was not observed");
}
