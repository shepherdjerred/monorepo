// Execute actual consumer gates; incidental metadata links are not migration requirements.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";
import { createLatestDirectEffectPlacement } from "../latest-direct-effect-placement.mjs";
import { loadLatestDirectEffectPackage } from "../latest-direct-effect-package.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";

const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: bun inspect-selected-package-gates.mjs <cache>");
const cache = resolve(cacheArg),
  inputs = {},
  stages = [];
async function raw(path) {
  path = resolve(path);
  const file = Bun.file(path);
  if (!(await file.exists()))
    throw Error("Required static input absent: " + path);
  const bytes = await file.bytes(),
    digest = await sha256(bytes);
  if (inputs[path] && inputs[path] !== digest)
    throw Error("Gate input changed: " + path);
  inputs[path] = digest;
  return bytes;
}
const load = (path) => raw(`${cache}/public/${path}`);
await captureDirectSourceInputs([import.meta.path], raw);
const selection = await loadLatestStaticCatalogSelection({ load }),
  profile = selection.profile(),
  manifestBytes = await selection.readRole("effects");
const contexts = await createLatestEffectContexts({
  profile,
  packageBytes: await selection.readRole("effectContexts"),
  effectsManifestBytes: manifestBytes,
  staticCatalog: selection,
});
stages.push({
  consumer: "selected-effect-contexts",
  status: "accepted",
  contexts: contexts.metadata.contexts.length,
});
async function gate(consumer, action, scope) {
  try {
    await action();
    stages.push({ consumer, status: "accepted", scope });
  } catch (error) {
    stages.push({
      consumer,
      status: "blocked",
      error: { name: error.name, message: error.message },
      scope,
    });
  }
}
await gate(
  "fixed-world-descriptor-ABI",
  async () => {
    await createLatestDirectEffectPlacement({
      profile,
      packageBytes: await load("latest-world-descriptor-abi/package.json"),
    });
  },
  "Build-only descriptor placement contract; no world placement is inferred",
);
await gate(
  "authored-effect-resolvers",
  async () => {
    await createLatestEffectResolvers({
      profile,
      contexts,
      packageBytes: await selection.readRole("effectResolvers"),
      effectsManifestBytes: manifestBytes,
      builtinContextPackageBytes: await load(
        "latest-builtin-resource-contexts/package.json",
      ),
      staticCatalog: selection,
    });
  },
  "Current ordinary resolver consumer with selected authored rows; no supplied expected digest",
);
await gate(
  "direct-effect-static-compiler-empty-inventory",
  async () => {
    await loadLatestDirectEffectPackage({ load, manifestBytes, effectIds: [] });
  },
  "Actual package acquisition and material bridge gates; no effect definitions or draws requested",
);
for (const [path, hash] of Object.entries(inputs))
  if ((await sha256(await Bun.file(path).bytes())) !== hash)
    throw Error("Gate input changed before publication: " + path);
const output = `${cache}/research/selected-package-execution-gates.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-selected-static-consumer-gates",
      inputs,
      catalog: selection.describe(),
      stages,
      scope: {
        ordinarySessionComplete: false,
        renderedCoverage: false,
        failuresAreExplicitMigrationDependencies: true,
        downstreamGatesNotReachedAreNotClaimed: true,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, stages }));
