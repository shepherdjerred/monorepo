// Browser fetch.arrayBuffer inputs must produce the same owned factories as
// CLI Uint8Array inputs. Both go through the public production boundaries.
import { resolve } from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { loadLatestStaticCatalogSelection } from "../latest-static-catalog.mjs";
import { createLatestCorpsePolicy } from "../latest-corpse.mjs";
import { createLatestSubmeshVisibility } from "../latest-submesh-visibility.mjs";
import { createLatestEffectContexts } from "../latest-effect-contexts.mjs";
import { createLatestEffectResolvers } from "../latest-effect-resolvers.mjs";
import { sameDirectCompiledData } from "../latest-direct-compiled-restore.mjs";
import { captureDirectSourceInputs } from "./direct-source-inputs.mjs";
const [cacheArg] = process.argv.slice(2);
if (!cacheArg || process.argv.length !== 3)
  throw Error("Usage: inspect-selected-browser-byte-inputs.mjs <cache>");
const cache = resolve(cacheArg),
  inputs = {};
async function raw(path) {
  path = resolve(path);
  const bytes = await Bun.file(path).bytes();
  inputs[path] = await sha256(bytes);
  return bytes;
}
await captureDirectSourceInputs([import.meta.path], raw);
const selection = await loadLatestStaticCatalogSelection({
    load: (p) => raw(`${cache}/public/${p}`),
  }),
  profile = selection.profile(),
  scene = await selection.readRole("scene"),
  world = await selection.read(
    `latest-scene/${JSON.parse(new TextDecoder().decode(scene)).world}`,
  ),
  corpse = await selection.readRole("corpsePolicy"),
  submesh = await selection.readRole("submeshVisibility"),
  contexts = await selection.readRole("effectContexts"),
  resolvers = await selection.readRole("effectResolvers"),
  effects = await selection.readRole("effects"),
  builtin = await selection.read(
    "latest-builtin-resource-contexts/package.json",
  );
const results = [];
for (const shape of ["Uint8Array", "ArrayBuffer"]) {
  const bytes = (b) =>
    shape === "ArrayBuffer"
      ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
      : b.slice();
  const c = await createLatestCorpsePolicy(
      profile,
      bytes(scene),
      bytes(world),
      bytes(corpse),
      selection,
    ),
    s = await createLatestSubmeshVisibility(
      profile,
      bytes(scene),
      bytes(submesh),
      selection,
    ),
    x = await createLatestEffectContexts({
      profile,
      packageBytes: bytes(contexts),
      effectsManifestBytes: bytes(effects),
      staticCatalog: selection,
    }),
    r = await createLatestEffectResolvers({
      profile,
      packageBytes: bytes(resolvers),
      effectsManifestBytes: bytes(effects),
      builtinContextPackageBytes: bytes(builtin),
      contexts: x,
      staticCatalog: selection,
    });
  results.push({
    shape,
    corpsePackageSha256: c.packageSha256,
    corpse: c.metadata,
    submesh: s.metadata,
    contexts: x.metadata,
    resolvers: r.metadata,
  });
}
const comparable = ({ shape, ...rest }) => rest;
if (!sameDirectCompiledData(comparable(results[0]), comparable(results[1])))
  throw Error("Browser ArrayBuffer factory output differs from Uint8Array");
const output = `${cache}/research/selected-browser-byte-input-control.json`;
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "actual-selected-browser-byte-factory-input-parity",
      inputs,
      counts: { factories: 4, inputShapes: 2 },
      results: results.map(({ shape, corpsePackageSha256 }) => ({
        shape,
        corpsePackageSha256,
      })),
      scope: {
        actualPublicFactoriesExecuted: true,
        arrayBufferAndUint8ArrayOutputsExact: true,
        strictSelectedOwnerChecksPreserved: true,
        browserExecuted: false,
      },
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ output, factories: 4, inputShapes: 2 }));
