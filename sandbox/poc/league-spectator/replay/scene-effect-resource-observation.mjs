import { sha256 } from "./structural-comparison.mjs";
import {
  assertLatestStaticCatalogSelection,
  STATIC_CATALOG_DECODER_IMAGE_SHA256,
} from "./latest-static-catalog.mjs";
import { sameDirectCompiledData as same } from "./latest-direct-compiled-restore.mjs";
import {
  SCENE_EFFECT_IDENTITY_V2,
  SCENE_EFFECT_LOOKUP_V2,
  SCENE_EFFECT_RESOURCE_RECIPE_V2,
  SCENE_EFFECT_RESOURCE_FINGERPRINTS_V2,
  SCENE_EFFECT_RESOURCE_FINGERPRINTS_V3,
  SCENE_EFFECT_RESOURCE_RECIPE_V3,
} from "./scene-effect-resource-contract.mjs";

const decode = (bytes) =>
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  ordered = (value) =>
    Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  digestEntries = (value) =>
    sha256(new TextEncoder().encode(JSON.stringify(ordered(value))));
const sourceNames = (value) => {
  const entries = Object.entries(value).map(([file, digest]) => [
    file.replaceAll("\\", "/").split("/").at(-1),
    digest,
  ]);
  if (new Set(entries.map(([file]) => file)).size !== entries.length)
    throw Error("Ambiguous scene resource producer source names");
  return Object.fromEntries(entries);
};
const token = (value) => {
  if (!/^\{[a-f\d]{8}\}$/.test(value))
    throw Error("Original unsigned resource reference token required");
  return Number.parseInt(value.slice(1, -1), 16);
};
export function originalSceneResourceRows(actor) {
  return Object.entries(actor.resources)
    .map(([key, value]) => {
      if (!/^[a-f\d]{8}$/.test(key))
        throw Error("Original unsigned resource key required");
      return {
        key: Number.parseInt(key, 16),
        referenceToken: token(value.reference),
      };
    })
    .sort((left, right) => left.key - right.key);
}
const sortedSources = (values) =>
  values
    .map((value) => ({ file: value.file.toLowerCase(), sha256: value.sha256 }))
    .sort((left, right) =>
      left.file < right.file ? -1 : left.file > right.file ? 1 : 0,
    );

const aliasPolicy =
  "original-ascii-case-insensitive-namespace-with-complete-per-alias-source-witness";
const asciiIdentity = (value) => {
  if (typeof value !== "string" || !/^[\x01-\x7f]{1,1024}$/.test(value))
    throw Error("Original bounded ASCII namespace identity required");
  return value.toLowerCase();
};

// Aliases share only source-equivalent static data. This never merges entities,
// original joint identities, creation events or loaded native object pointers.
export function validateSceneEffectAliases({
  contexts,
  effects,
  inputs,
  scene,
  world,
}) {
  const appearances = new Map([
      ...Object.entries(scene.champions).map(([key, value]) => [
        `champions/${key}`,
        value,
      ]),
      ...Object.entries(world.assets).map(([key, value]) => [
        `world/${key}`,
        value,
      ]),
    ]),
    seen = new Set(),
    identities = new Set();
  const caseWitnesses = inputs.aliasIdentityPolicy === aliasPolicy;
  if (inputs.aliasIdentityPolicy !== undefined && !caseWitnesses)
    throw Error("Unknown original alias identity policy");
  if (
    inputs.schema !== 2 ||
    inputs.kind !== "original-scene-effect-resource-inputs" ||
    inputs.nativeSpectatorAdmitted !== false ||
    contexts.length !== inputs.contexts.length ||
    inputs.appearances !== appearances.size ||
    Object.keys(effects.actors).length !== appearances.size
  )
    throw Error("Complete source-bound scene context inventory required");
  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index],
      input = inputs.contexts[index],
      source = context.sourceIdentity;
    if (
      !Array.isArray(context.actorAliases) ||
      !context.actorAliases.length ||
      context.actorAliases[0] !== context.actorKey ||
      identities.has(context.identity) ||
      !same(context.actorAliases, input.actorAliases) ||
      context.actorKey !== input.actorKey ||
      !same(source, input.sourceIdentity) ||
      (caseWitnesses &&
        (!same(context.aliasSources, input.aliasSources) ||
          context.aliasSources?.length !== context.actorAliases.length)) ||
      source.character !== context.name ||
      source.skinId !== context.skinId ||
      context.namespace !== "characters" ||
      (context.resourceResolverId === null
        ? null
        : token(context.resourceResolverId)) !== source.resolverId
    )
      throw Error("Scene context alias/native source identity differs");
    identities.add(context.identity);
    for (const [aliasIndex, key] of context.actorAliases.entries()) {
      const actor = effects.actors[key],
        appearance = appearances.get(key),
        witness = caseWitnesses
          ? context.aliasSources[aliasIndex]
          : { actorKey: key, name: context.name, sourceIdentity: source };
      if (
        witness.actorKey !== key ||
        !same(
          {
            ...witness.sourceIdentity,
            character: asciiIdentity(witness.sourceIdentity.character),
          },
          { ...source, character: asciiIdentity(source.character) },
        ) ||
        witness.name !== witness.sourceIdentity.character ||
        seen.has(key) ||
        !actor ||
        !appearance ||
        actor.character !== witness.name ||
        actor.skinId !== context.skinId ||
        actor.resourceResolverId !== context.resourceResolverId ||
        appearance.character !== witness.name ||
        appearance.skinId !== source.skinId ||
        appearance.source.skinSha256 !== source.skinSha256 ||
        appearance.source.wad.toLowerCase() !== source.wad ||
        !same(
          sortedSources(
            appearance.source.bins.map((entry) => ({
              file: entry.path,
              sha256: entry.sha256,
            })),
          ),
          sortedSources(source.sourceRows),
        ) ||
        !same(originalSceneResourceRows(actor), source.rows)
      )
        throw Error(
          "Scene alias changes complete original appearance/resolver sources",
        );
      seen.add(key);
    }
  }
  if (seen.size !== appearances.size)
    throw Error("Scene appearance alias coverage is incomplete");
  return {
    appearances: seen.size,
    canonicalContexts: contexts.length,
    aliases: seen.size - contexts.length,
  };
}

async function selectedProof({
  selection,
  profile,
  metadata,
  packageBytes,
  role,
  mode,
}) {
  const fingerprints =
    metadata.recipe === SCENE_EFFECT_RESOURCE_RECIPE_V2
      ? SCENE_EFFECT_RESOURCE_FINGERPRINTS_V2
      : metadata.recipe === SCENE_EFFECT_RESOURCE_RECIPE_V3
        ? SCENE_EFFECT_RESOURCE_FINGERPRINTS_V3
        : null;
  assertLatestStaticCatalogSelection(selection);
  if (
    !same(selection.profile(), profile) ||
    profile.decoderImageSha256 !== STATIC_CATALOG_DECODER_IMAGE_SHA256
  )
    throw Error("Scene resource requires unchanged selected native profile");
  await selection.assertRole(role, packageBytes);
  const proofBytes = await selection.readRole(
      mode === "contexts" ? "effectContextsProof" : "effectResolversProof",
    ),
    proof = decode(proofBytes),
    inputBytes = await selection.readRole("sceneEffectResourceInputs"),
    inputs = decode(inputBytes),
    effectsBytes = await selection.readRole("effects"),
    effects = decode(effectsBytes),
    sceneBytes = await selection.readRole("scene"),
    scene = decode(sceneBytes),
    sceneTarget = selection.describe().roles.scene,
    directory = sceneTarget.slice(0, sceneTarget.lastIndexOf("/") + 1),
    world = decode(await selection.read(directory + scene.world));
  if (
    metadata.schema !== 2 ||
    fingerprints === null ||
    metadata.preparerSha256 !== fingerprints.preparer ||
    metadata.nativeSpectatorAdmitted !== false ||
    metadata.build !== profile.clientVersion ||
    metadata.protocol !== profile.protocolDigest ||
    metadata.decoderImageSha256 !== profile.decoderImageSha256 ||
    metadata.effectsManifestSha256 !== (await sha256(effectsBytes)) ||
    metadata.sceneManifestSha256 !== (await sha256(sceneBytes)) ||
    metadata.resourceInputsSha256 !== (await sha256(inputBytes)) ||
    metadata.observationSha256 !== (await sha256(proofBytes)) ||
    proof.schema !== 2 ||
    proof.kind !==
      `native-scene-${mode === "contexts" ? "character-effect-context-observations" : "authored-resource-resolver-observations"}` ||
    proof.build !== metadata.build ||
    proof.protocol !== metadata.protocol ||
    proof.effectsManifestSha256 !== metadata.effectsManifestSha256 ||
    proof.sceneManifestSha256 !== metadata.sceneManifestSha256 ||
    proof.inputManifestSha256 !== metadata.resourceInputsSha256 ||
    proof.decoderImageSha256 !== profile.decoderImageSha256 ||
    proof.nativeSpectatorAdmitted !== false ||
    !same(proof.originalBlocks, metadata.sourceBlocks) ||
    inputs.compilerSources["prepare-scene-effect-resource-inputs.mjs"] !==
      fingerprints.inputPreparer ||
    (await digestEntries(sourceNames(inputs.compilerSources))) !==
      fingerprints.inputSources ||
    (await digestEntries(sourceNames(proof.inputProducerSources))) !==
      fingerprints.inputSources ||
    (await digestEntries(proof.sources)) !== fingerprints[mode]
  )
    throw Error(
      "Scene resource original observation/program authority differs",
    );
  if (
    proof.scope.staticBuildDataOnly !== true ||
    proof.scope.containsReplayEvents !== false ||
    proof.scope.assetLoadingExecuted !== false ||
    proof.scope.effectFactoryExecuted !== false ||
    proof.scope.fullResourcePrecedenceVerified !== false ||
    proof.scope.fullMatchRegistryReconstructed !== false ||
    proof.scope.appearanceAliasesBoundToCompleteOriginalSources !== true ||
    proof.scope.browserExecuted !== false ||
    proof.scope.referenceCompared !== false
  )
    throw Error("Scene resource native observation exceeds its admitted scope");
  await selection.verifyNativeImageBlocks(proof.originalBlocks);
  for (const rva of mode === "contexts"
    ? [0x1442120, 0x14371c0, 0x351910, 0x351af4, 0x354280]
    : [0x16153d0, 0x377890])
    if (
      !proof.originalBlocks.some(
        (block) => block.rva <= rva && rva < block.rva + block.size,
      )
    )
      throw Error("Original scene resource entry was not observed");
  return { proof, inputs, effects, scene, world };
}

export async function assertSceneContextObservation(options) {
  const { metadata } = options,
    evidence = await selectedProof({
      ...options,
      role: "effectContexts",
      mode: "contexts",
    }),
    { proof, inputs, effects, scene, world } = evidence;
  const coverage = validateSceneEffectAliases({
    contexts: metadata.contexts,
    effects,
    inputs,
    scene,
    world,
  });
  if (
    !same(metadata.identity, SCENE_EFFECT_IDENTITY_V2) ||
    proof.counts.canonicalContexts !== coverage.canonicalContexts ||
    proof.counts.appearances !== coverage.appearances ||
    proof.counts.aliases !== coverage.aliases ||
    proof.cases.length !== metadata.contexts.length ||
    proof.controls.boundaries.length !== 9 ||
    proof.scope.originalConstructorPrefix !== true ||
    proof.scope.originalIdentityFragment !== true ||
    proof.scope.decimalSkinTextSuppliedAndCFormatterCompared !== true ||
    proof.scope.originalRegistryInsertionAndLookup !== true ||
    proof.scope.duplicateRegistryInsertionAndLookupObserved !== true ||
    metadata.scope.sourceBoundAppearanceAliases !== true ||
    metadata.scope.originalIdentityAndRegistryObserved !== true ||
    metadata.scope.nativeDecimalFormatterExecuted !== false ||
    metadata.scope.staticAssetLoaderExecuted !== false ||
    metadata.scope.originalDuplicateRegistryBehaviorObserved !== true
  )
    throw Error("Complete original scene context controls required");
  const boundarySkins = [0, 1, 9, 10, 99, 100, 65535, 0x7fffffff, 0xffffffff];
  if (
    proof.controls.boundaries.some(
      (row, index) =>
        row.skinId !== boundarySkins[index] ||
        row.decimalAscii !== String(boundarySkins[index]) ||
        row.name !== "Ornn" ||
        row.namespace !== "characters",
    )
  )
    throw Error("Original unsigned skin formatter boundary control differs");
  for (let index = 0; index < metadata.contexts.length; index++) {
    const row = metadata.contexts[index],
      actual = proof.cases[index];
    for (const key of [
      "actorKey",
      "actorAliases",
      "sourceIdentity",
      "name",
      "skinId",
      "namespace",
      "identity",
    ])
      if (!same(row[key], actual[key]))
        throw Error("Original scene context observed row differs");
  }
  const aliases = metadata.contexts.filter(
    (row) => row.actorAliases.length > 1,
  );
  const caseWitnesses = metadata.recipe === SCENE_EFFECT_RESOURCE_RECIPE_V3;
  if (
    caseWitnesses &&
    (inputs.aliasIdentityPolicy !== aliasPolicy ||
      proof.scope.originalAliasSpellingsConstructed !== true)
  )
    throw Error("Original alias spelling constructors were not observed");
  if (
    caseWitnesses &&
    metadata.contexts.some(
      (row, index) => !same(row.aliasSources, proof.cases[index].aliasSources),
    )
  )
    throw Error(
      "Original per-alias source witnesses differ from native observation",
    );
  if (
    proof.controls.duplicateRegistry.length !==
    (caseWitnesses
      ? aliases.reduce((total, row) => total + row.actorAliases.length - 1, 0)
      : aliases.length)
  )
    throw Error("Original duplicate registry inventory differs");
  for (const row of aliases) {
    for (const witness of caseWitnesses
      ? row.aliasSources.slice(1)
      : [{ actorKey: null }]) {
      const control = proof.controls.duplicateRegistry.find(
        (entry) =>
          entry.actorKey === row.actorKey &&
          (!caseWitnesses || entry.aliasActorKey === witness.actorKey),
      );
      if (
        !control ||
        !same(control.actorAliases, row.actorAliases) ||
        control.identity !== row.identity ||
        control.firstObject === control.secondObject ||
        control.firstLookup !== control.firstObject ||
        control.secondLookup !== control.secondObject ||
        control.observedPointerSelection !== "last" ||
        (caseWitnesses &&
          (control.firstName !== row.name ||
            control.secondName !== witness.name))
      )
        throw Error(
          "Original duplicate registry insertion/lookup control differs",
        );
    }
  }
}

export async function assertSceneResolverObservation(options) {
  const { metadata, contexts } = options,
    evidence = await selectedProof({
      ...options,
      role: "effectResolvers",
      mode: "resolvers",
    }),
    { proof, inputs, effects, scene, world } = evidence,
    contextBytes = await options.selection.readRole("effectContexts");
  validateSceneEffectAliases({
    contexts: contexts.metadata.contexts,
    effects,
    inputs,
    scene,
    world,
  });
  if (
    metadata.contextsPackageSha256 !== (await sha256(contextBytes)) ||
    !same(contexts.metadata, decode(contextBytes)) ||
    !same(metadata.lookup, SCENE_EFFECT_LOOKUP_V2) ||
    metadata.actors.length !== contexts.metadata.contexts.length ||
    proof.cases.length !== metadata.actors.length ||
    proof.counts.canonicalContexts !== metadata.actors.length ||
    proof.scope.originalSerializedFieldReader !== true ||
    proof.scope.originalReflectionInitializer !== true ||
    proof.scope.originalKeyLookup !== true ||
    proof.scope.originalAuxiliaryChainExecuted !== true ||
    proof.scope.unitResourceContextsSuppliedEmpty !== true ||
    proof.scope.returnedValuesAreUnresolvedAssetReferences !== true ||
    proof.scope.postloadExecuted !== false ||
    proof.scope.externalLinksResolved !== false ||
    proof.scope.globalResolutionStagesExecuted !== false ||
    !proof.controls.auxiliaryChains.length ||
    metadata.scope.sourceBoundAppearanceAliases !== true
  )
    throw Error("Complete original scene resolver controls required");
  for (let index = 0; index < metadata.actors.length; index++) {
    const row = metadata.actors[index],
      actual = proof.cases[index],
      context = contexts.metadata.contexts[index];
    if (
      row.actorKey !== context.actorKey ||
      row.contextIdentity !== context.identity ||
      !same(row.actorAliases, context.actorAliases) ||
      (metadata.recipe === SCENE_EFFECT_RESOURCE_RECIPE_V3 &&
        (!same(row.aliasSources, context.aliasSources) ||
          !same(actual.aliasSources, row.aliasSources))) ||
      !same(row.sourceIdentity, context.sourceIdentity) ||
      row.status !== actual.status ||
      actual.actorKey !== row.actorKey ||
      !same(actual.sourceIdentity, row.sourceIdentity) ||
      !same(actual.actorAliases, row.actorAliases) ||
      row.resourceResolverId !== row.sourceIdentity.resolverId ||
      !same(row.rows, row.sourceIdentity.rows)
    )
      throw Error("Scene resolver alias/native source row differs");
    if (row.status === "no-authored-resource-resolver") {
      if (
        row.resourceResolverId !== null ||
        row.rows.length ||
        actual.probes.length
      )
        throw Error("Absent original scene resolver has entries");
    } else if (row.status === "native-resource-map-loaded") {
      if (
        !same(
          row.rows,
          actual.loaded.rows.map(({ key, value }) => ({
            key,
            referenceToken: value,
          })),
        )
      )
        throw Error("Original scene typed resolver rows differ");
      for (const entry of row.rows)
        if (
          !actual.probes.some(
            (probe) =>
              probe.key === entry.key &&
              probe.found === true &&
              probe.value === entry.referenceToken,
          )
        )
          throw Error(
            "Original scene resolver lookup did not observe every row",
          );
      for (const key of [0, 1, 0xffffffff])
        if (
          !row.rows.some((entry) => entry.key === key) &&
          !actual.probes.some(
            (probe) =>
              probe.key === key && probe.found === false && probe.value === 0,
          )
        )
          throw Error("Original scene resolver missing-key control differs");
    } else throw Error("Unknown scene resolver native state");
  }
  for (const chain of proof.controls.auxiliaryChains) {
    const row = metadata.actors.find(
        (entry) => entry.actorKey === chain.actors[0],
      ),
      first = row?.rows.find((entry) => entry.key === chain.resourceKey),
      original = proof.cases.find((entry) => entry.actorKey === row?.actorKey);
    if (
      ![1, 2].includes(chain.actors.length) ||
      chain.actors.some(
        (key) => !metadata.actors.some((entry) => entry.actorKey === key),
      ) ||
      !first ||
      chain.status !== "matched-authored-reference" ||
      chain.value !== first.referenceToken ||
      chain.owner !== original.loaded.object
    )
      throw Error("Original scene auxiliary chain control differs");
  }
  for (const row of metadata.actors)
    if (
      row.rows.length &&
      !proof.controls.auxiliaryChains.some(
        (chain) =>
          chain.actors.length === 1 &&
          chain.actors[0] === row.actorKey &&
          chain.resourceKey === row.rows[0].key,
      )
    )
      throw Error("Original scene resolver lacks its auxiliary-chain control");
  return metadata.contextsPackageSha256;
}
