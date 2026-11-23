// Output-only scene data. Original profile/image/program packages stay read-only.
import path from "node:path";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  SCENE_EFFECT_IDENTITY_V2,
  SCENE_EFFECT_LOOKUP_V2,
  SCENE_EFFECT_RESOURCE_RECIPE_V3,
} from "../scene-effect-resource-contract.mjs";

const [sourceArg, inputArg, contextArg, resolverArg, cacheArg] =
  process.argv.slice(2);
if (!cacheArg)
  throw Error(
    "Usage: bun prepare-scene-effect-resources.mjs <approved-source-cache> <resource-inputs> <native-context-proof.json> <native-resolver-proof.json> <archive-cache>",
  );
const { sourceCache, out } = await createStaticPreparationOutput(
    sourceArg,
    cacheArg,
    { prefix: "effect-resources-", directory: "effect-resources" },
  ),
  inputRoot = path.resolve(inputArg),
  inputBytes = await Bun.file(path.join(inputRoot, "manifest.json")).bytes(),
  inputs = JSON.parse(new TextDecoder().decode(inputBytes)),
  contextBytes = await Bun.file(contextArg).bytes(),
  context = JSON.parse(new TextDecoder().decode(contextBytes)),
  resolverBytes = await Bun.file(resolverArg).bytes(),
  resolver = JSON.parse(new TextDecoder().decode(resolverBytes)),
  image = await Bun.file(
    path.join(sourceCache, "public/decoder-16.21-macos/image.bin"),
  ).bytes(),
  profileBytes = await Bun.file(
    path.join(sourceCache, "public/decoder-16.21-macos/profile.json"),
  ).bytes(),
  profile = JSON.parse(new TextDecoder().decode(profileBytes)),
  producerSha = sha(await Bun.file(import.meta.path).bytes());
if (
  inputs.schema !== 2 ||
  inputs.kind !== "original-scene-effect-resource-inputs" ||
  inputs.nativeSpectatorAdmitted !== false ||
  profile.decoderImageSha256 !== sha(image)
)
  throw Error("Exact original scene resource inputs required");
for (const [proof, kind] of [
  [context, "native-scene-character-effect-context-observations"],
  [resolver, "native-scene-authored-resource-resolver-observations"],
]) {
  if (
    proof.schema !== 2 ||
    proof.kind !== kind ||
    proof.inputManifestSha256 !== sha(inputBytes) ||
    proof.effectsManifestSha256 !== inputs.effectsManifestSha256 ||
    proof.sceneManifestSha256 !== inputs.sceneManifestSha256 ||
    proof.build !== inputs.build ||
    proof.protocol !== inputs.protocol ||
    proof.build !== profile.clientVersion ||
    proof.protocol !== profile.protocolDigest ||
    proof.decoderImageSha256 !== sha(image) ||
    proof.counts.canonicalContexts !== inputs.contexts.length ||
    proof.counts.appearances !== inputs.appearances ||
    proof.nativeSpectatorAdmitted !== false
  )
    throw Error(
      "Matching complete original scene resource observations required",
    );
  for (const [file, digest] of Object.entries({
    ...proof.inputs,
    ...proof.inputProducerSources,
  }))
    if (sha(await Bun.file(file).bytes()) !== digest)
      throw Error(`Original resource observation input changed: ${file}`);
  for (const [file, digest] of Object.entries(proof.sources))
    if (sha(await Bun.file(new URL(file, import.meta.url)).bytes()) !== digest)
      throw Error(`Original resource observer changed: ${file}`);
  for (const block of proof.originalBlocks)
    if (sha(image.subarray(block.rva, block.rva + block.size)) !== block.sha256)
      throw Error("Original resource instruction block changed");
}
const contexts = context.cases.map((row, index) => {
  const expected = inputs.contexts[index];
  if (
    row.actorKey !== expected.actorKey ||
    JSON.stringify(row.actorAliases) !==
      JSON.stringify(expected.actorAliases) ||
    JSON.stringify(row.sourceIdentity) !==
      JSON.stringify(expected.sourceIdentity)
  )
    throw Error("Original context alias/source identity differs");
  return {
    actorKey: row.actorKey,
    actorAliases: row.actorAliases,
    aliasSources: row.aliasSources,
    name: row.name,
    skinId: row.skinId,
    namespace: row.namespace,
    identity: row.identity,
    resourceResolverId:
      expected.sourceIdentity.resolverId === null
        ? null
        : `{${expected.sourceIdentity.resolverId.toString(16).padStart(8, "0")}}`,
    sourceIdentity: row.sourceIdentity,
  };
});
const common = {
    schema: 2,
    build: inputs.build,
    protocol: inputs.protocol,
    decoderImageSha256: sha(image),
    effectsManifestSha256: inputs.effectsManifestSha256,
    sceneManifestSha256: inputs.sceneManifestSha256,
    resourceInputsSha256: sha(inputBytes),
    recipe: SCENE_EFFECT_RESOURCE_RECIPE_V3,
    preparerSha256: producerSha,
    nativeSpectatorAdmitted: false,
  },
  contextPackage = {
    ...common,
    kind: "prepared-character-effect-contexts",
    identity: SCENE_EFFECT_IDENTITY_V2,
    contexts,
    observationSha256: sha(contextBytes),
    sourceBlocks: context.originalBlocks,
    scope: {
      staticBuildDataOnly: true,
      containsReplayEvents: false,
      originalIdentityAndRegistryObserved: true,
      nativeDecimalFormatterExecuted: false,
      staticAssetLoaderExecuted: false,
      fullResourcePrecedenceVerified: false,
      fullMatchRegistryReconstructed: false,
      sourceBoundAppearanceAliases: true,
      originalDuplicateRegistryBehaviorObserved: true,
    },
  },
  encodedContext = new TextEncoder().encode(
    JSON.stringify(contextPackage, null, 2),
  ),
  resolverPackage = {
    ...common,
    kind: "prepared-authored-effect-resolvers",
    contextsPackageSha256: sha(encodedContext),
    observationSha256: sha(resolverBytes),
    lookup: SCENE_EFFECT_LOOKUP_V2,
    sourceBlocks: resolver.originalBlocks,
    actors: resolver.cases.map((row, index) => {
      const expected = inputs.contexts[index],
        observed = contexts[index];
      if (
        row.actorKey !== expected.actorKey ||
        JSON.stringify(row.actorAliases) !==
          JSON.stringify(expected.actorAliases) ||
        JSON.stringify(row.sourceIdentity) !==
          JSON.stringify(expected.sourceIdentity)
      )
        throw Error("Original resolver alias/source identity differs");
      return {
        actorKey: row.actorKey,
        actorAliases: row.actorAliases,
        aliasSources: row.aliasSources,
        contextIdentity: observed.identity,
        status: row.status,
        sourceIdentity: row.sourceIdentity,
        resourceResolverId: expected.sourceIdentity.resolverId,
        rows:
          row.status === "no-authored-resource-resolver"
            ? []
            : row.loaded.rows.map(({ key, value }) => ({
                key,
                referenceToken: value,
              })),
      };
    }),
    scope: {
      staticBuildDataOnly: true,
      containsReplayEvents: false,
      originalTypedMapsAndAuxiliaryOrderObserved: true,
      externalLinksResolved: false,
      unitResourcePrecedenceVerified: false,
      globalResolutionVerified: false,
      effectFactoryExecuted: false,
      sourceBoundAppearanceAliases: true,
    },
  };
const files = [];
for (const [file, data] of [
  ["contexts.json", encodedContext],
  [
    "resolvers.json",
    new TextEncoder().encode(JSON.stringify(resolverPackage, null, 2)),
  ],
  ["contexts-native.json", contextBytes],
  ["resolvers-native.json", resolverBytes],
  ["resource-inputs.json", inputBytes],
]) {
  await Bun.write(path.join(out, file), data);
  files.push({ file, bytes: data.length, sha256: sha(data) });
}
if (
  sha(await Bun.file(import.meta.path).bytes()) !== producerSha ||
  sha(
    await Bun.file(
      path.join(sourceCache, "public/decoder-16.21-macos/profile.json"),
    ).bytes(),
  ) !== sha(profileBytes) ||
  sha(
    await Bun.file(
      path.join(sourceCache, "public/decoder-16.21-macos/image.bin"),
    ).bytes(),
  ) !== sha(image)
)
  throw Error("Original resource producer/native authority changed");
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      ...common,
      kind: "prepared-scene-effect-resource-authority",
      roles: {
        effectContexts: "contexts.json",
        effectResolvers: "resolvers.json",
        effectContextsProof: "contexts-native.json",
        effectResolversProof: "resolvers-native.json",
        sceneEffectResourceInputs: "resource-inputs.json",
      },
      files,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    canonicalContexts: contexts.length,
    appearances: inputs.appearances,
    profileUnchanged: true,
    nativeSpectatorAdmitted: false,
  }),
);
