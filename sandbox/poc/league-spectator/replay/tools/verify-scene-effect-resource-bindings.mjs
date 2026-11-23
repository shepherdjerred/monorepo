import path from "node:path";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";

const [rootArg] = process.argv.slice(2);
if (!rootArg)
  throw Error(
    "Usage: bun verify-scene-effect-resource-bindings.mjs <closed-selected-public-root>",
  );
const root = path.resolve(rootArg),
  selection = await loadLatestStaticCatalogSelection({
    load: (file) => Bun.file(path.join(root, file)).bytes(),
  }),
  profile = selection.profile(),
  effectsManifestBytes = await selection.readRole("effects"),
  contexts = await createLatestEffectContexts({
    profile,
    packageBytes: await selection.readRole("effectContexts"),
    effectsManifestBytes,
    staticCatalog: selection,
  }),
  resolvers = await createLatestEffectResolvers({
    profile,
    packageBytes: await selection.readRole("effectResolvers"),
    effectsManifestBytes,
    contexts,
    builtinContextPackageBytes: await selection.readRole(
      "builtinResourceContexts",
    ),
    staticCatalog: selection,
  }),
  native = JSON.parse(
    new TextDecoder().decode(await selection.readRole("effectResolversProof")),
  );
let rows = 0,
  aliases = 0;
for (const context of contexts.metadata.contexts) {
  const actual = contexts.lookup(context.identity);
  if (
    actual.actorKey !== context.actorKey ||
    JSON.stringify(actual.actorAliases) !== JSON.stringify(context.actorAliases)
  )
    throw Error("Owned native context alias lookup differs");
  aliases += context.actorAliases.length;
}
for (const actor of resolvers.metadata.actors) {
  for (const row of actor.rows) {
    const found = resolvers.lookup(actor.contextIdentity, row.key);
    if (
      found.status !== "matched-authored-reference" ||
      found.referenceToken !== row.referenceToken ||
      found.actorKey !== actor.actorKey
    )
      throw Error("Selected JS/native resource lookup differs");
    rows++;
  }
  for (const key of [1, 0xffffffff])
    if (!actor.rows.some((row) => row.key === key)) {
      const found = resolvers.lookup(actor.contextIdentity, key);
      if (
        !["key-absent", "no-authored-resource-resolver"].includes(found.status)
      )
        throw Error("Selected JS/native missing resource lookup differs");
    }
}
for (const chain of native.controls.auxiliaryChains) {
  const ids = chain.actors.map(
      (key) =>
        resolvers.metadata.actors.find((actor) => actor.actorKey === key)
          .contextIdentity,
    ),
    actual = resolvers.selectAuxiliary(ids, chain.resourceKey);
  if (actual.status !== chain.status || actual.referenceToken !== chain.value)
    throw Error("Selected JS/native auxiliary order differs");
}
let rejected = 0;
for (const attempt of [
  async () =>
    createLatestEffectContexts({
      profile,
      packageBytes: await selection.readRole("effectContexts"),
      effectsManifestBytes,
    }),
  async () =>
    createLatestEffectContexts({
      profile: { ...profile, protocolDigest: "foreign" },
      packageBytes: await selection.readRole("effectContexts"),
      effectsManifestBytes,
      staticCatalog: selection,
    }),
  async () =>
    createLatestEffectResolvers({
      profile,
      packageBytes: new Uint8Array([0]),
      effectsManifestBytes,
      contexts,
      builtinContextPackageBytes: await selection.readRole(
        "builtinResourceContexts",
      ),
      staticCatalog: selection,
    }),
]) {
  try {
    await attempt();
  } catch {
    rejected++;
  }
}
if (rejected !== 3)
  throw Error("Unowned/incompatible/corrupt scene resource input was accepted");
console.log(
  JSON.stringify({
    canonicalContexts: contexts.metadata.contexts.length,
    appearances: aliases,
    rowsVerified: rows,
    auxiliaryControls: native.controls.auxiliaryChains.length,
    rejectedMismatches: rejected,
    nativeSpectatorAdmitted: false,
  }),
);
