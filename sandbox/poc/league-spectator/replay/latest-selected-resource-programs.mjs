// Selected data does not authorize different resource algorithms or observations.
import { sha256 } from "./structural-comparison.mjs";
import {
  assertDirectCompiledDataGraph,
  sameDirectCompiledData,
} from "./latest-direct-compiled-restore.mjs";
import {
  assertLatestStaticCatalogSelection,
  STATIC_CATALOG_DECODER_IMAGE_SHA256,
} from "./latest-static-catalog.mjs";
import { EFFECT_RESOLVERS_PACKAGE_SHA } from "./latest-effect-resolver-contract.mjs";
const decode = (bytes) =>
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
const PREPARER_SHA =
  "21d7b816976b4f2f6546934ee6e027ccf2c1d7993efaa631057b5fe144e5ff0d";
const NATIVE_SOURCES_SHA =
  "c03735e6800dbe0c9399e4ecadc62d0a24426122120e5ec4b3ae144c3ad31c6e";
const NATIVE_SCOPE = {
  partialSelection: false,
  originalReflectionInitializer: true,
  originalSerializedFieldReader: true,
  originalKeyLookup: true,
  postloadExecuted: false,
  externalLinksResolved: false,
  completeFactoryPrecedenceExecuted: false,
  browserExecuted: false,
  referenceCompared: false,
  originalAuxiliaryChainExecuted: true,
  unitResourceContextsSuppliedEmpty: true,
  globalResolutionStagesExecuted: false,
  returnedValuesAreUnresolvedAssetReferences: true,
};

export async function assertSelectedResourceRoot({
  selection,
  profile,
  manifestBytes = null,
}) {
  assertLatestStaticCatalogSelection(selection);
  assertDirectCompiledDataGraph(profile);
  if (!sameDirectCompiledData(profile, selection.profile()))
    throw Error("Resource profile differs from selected root");
  if (manifestBytes !== null)
    await selection.assertRole("effects", manifestBytes);
}

export async function assertSelectedResolverObservation({
  selection,
  profile,
  packageBytes,
  manifestBytes,
  contexts,
}) {
  await assertSelectedResourceRoot({ selection, profile, manifestBytes });
  await selection.assertRole("effectResolvers", packageBytes);
  const referenceBytes = await selection.readRole("effectResolversReference");
  if ((await sha256(referenceBytes)) !== EFFECT_RESOLVERS_PACKAGE_SHA)
    throw Error("Fixed original resolver program reference required");
  const metadata = decode(packageBytes),
    reference = decode(referenceBytes),
    contextBytes = await selection.readRole("effectContexts"),
    proofBytes = await selection.readRole("effectResolversProof"),
    proof = decode(proofBytes);
  assertDirectCompiledDataGraph(metadata);
  assertDirectCompiledDataGraph(proof);
  if (
    metadata.contextsPackageSha256 !== (await sha256(contextBytes)) ||
    !sameDirectCompiledData(contexts.metadata, decode(contextBytes)) ||
    metadata.preparerSha256 !== PREPARER_SHA ||
    metadata.observationSha256 !== (await sha256(proofBytes)) ||
    !sameDirectCompiledData(metadata.lookup, reference.lookup) ||
    !sameDirectCompiledData(metadata.scope, reference.scope) ||
    proof.schema !== 1 ||
    proof.kind !== "native-authored-resource-resolver-observations" ||
    proof.build !== profile.clientVersion ||
    proof.protocol !== profile.protocolDigest ||
    proof.decoderImageSha256 !== STATIC_CATALOG_DECODER_IMAGE_SHA256 ||
    !sameDirectCompiledData(proof.scope, NATIVE_SCOPE) ||
    !sameDirectCompiledData(proof.originalBlocks, metadata.sourceBlocks)
  )
    throw Error(
      "Selected resolver native observation/program approval differs",
    );
  const sources = Object.entries(proof.sources ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (
    (await sha256(new TextEncoder().encode(JSON.stringify(sources)))) !==
    NATIVE_SOURCES_SHA
  )
    throw Error("Selected resolver native producer sources are unapproved");
  const blocks = proof.originalBlocks,
    seen = new Set();
  const evidence = await selection.verifyNativeImageBlocks(blocks);
  for (const b of blocks) {
    if (
      !Number.isSafeInteger(b.rva) ||
      !Number.isSafeInteger(b.size) ||
      b.rva < 0 ||
      b.size <= 0 ||
      b.rva + b.size > evidence.imageBytes ||
      seen.has(b.rva)
    )
      throw Error("Selected resolver original instruction block differs");
    seen.add(b.rva);
  }
  for (const rva of [0x16153d0, 0x377890])
    if (!blocks.some((b) => b.rva <= rva && rva < b.rva + b.size))
      throw Error("Selected resolver original entry was not observed");
  if (
    !Array.isArray(proof.cases) ||
    proof.cases.length !== metadata.actors.length ||
    proof.counts.actors !== metadata.actors.length
  )
    throw Error("Complete selected resolver observation inventory required");
  for (let i = 0; i < metadata.actors.length; i++) {
    const actor = metadata.actors[i],
      observed = proof.cases[i];
    if (
      actor.actorKey !== observed.actorKey ||
      actor.status !== observed.status ||
      actor.sourceSha256 !== observed.sourceSha256
    )
      throw Error("Selected resolver observed actor differs");
    if (actor.status === "no-authored-resource-resolver") {
      if (
        actor.resourceResolverId !== null ||
        actor.rows.length ||
        observed.probes.length
      )
        throw Error("Absent selected resolver has native entries");
      continue;
    }
    if (
      actor.resourceResolverId !== observed.resourceResolverId ||
      !sameDirectCompiledData(
        actor.rows,
        observed.loaded.rows.map(({ key, value }) => ({
          key,
          referenceToken: value,
        })),
      )
    )
      throw Error("Selected resolver rows differ from original typed reader");
    for (const row of actor.rows)
      if (
        !observed.probes.some(
          (p) =>
            p.key === row.key &&
            p.found === true &&
            p.value === row.referenceToken,
        )
      )
        throw Error("Selected resolver row lacks its original lookup result");
  }
  return metadata.contextsPackageSha256;
}

// A fixed build-only program may retain its old context/manifest metadata only
// after its selected dependencies have separately acquired owned approval.
export async function assertSelectedFixedResourceProgram({
  selection,
  profile,
  role,
  packageBytes,
}) {
  await assertSelectedResourceRoot({ selection, profile });
  await selection.assertRole(role, packageBytes);
}

export async function assertSelectedResourceDependency(
  selection,
  role,
  metadata,
) {
  assertLatestStaticCatalogSelection(selection);
  assertDirectCompiledDataGraph(metadata);
  if (!sameDirectCompiledData(metadata, decode(await selection.readRole(role))))
    throw Error(
      "Owned resource dependency differs from selected role: " + role,
    );
}

export function projectApprovedNegativeCapabilities(
  metadata,
  manifest,
  sourcePackage,
) {
  assertDirectCompiledDataGraph(metadata);
  assertDirectCompiledDataGraph(manifest);
  assertDirectCompiledDataGraph(sourcePackage);
  const accepted = [],
    omitted = [];
  for (const capability of metadata.capabilities) {
    const actor = manifest.actors[capability.actorKey];
    if (!actor) {
      omitted.push({
        actorKey: capability.actorKey,
        reason:
          "resource:approved-negative-form-actor-absent-from-selected-content",
      });
      continue;
    }
    const source = sourcePackage.actors?.[
      capability.actorKey
    ]?.sourceBins?.find((row) => row.path === capability.skinPath);
    if (
      actor.character !== capability.character ||
      actor.skinId !== capability.skinId ||
      actor.skinPath !== capability.skinPath ||
      source?.sourceSha256 !== capability.skinSourceSha256
    )
      throw Error(
        "Selected negative-form capability source differs from original approval",
      );
    accepted.push(structuredClone(capability));
  }
  return { accepted, omitted };
}
