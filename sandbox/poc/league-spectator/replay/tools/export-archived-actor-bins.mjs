import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
const [parserCheckout, sourceArg, cacheArg, manifestFile] =
  process.argv.slice(2);
if (!manifestFile)
  throw Error(
    "Usage: bun export-archived-actor-bins.mjs <parser-checkout> <approved-source-cache> <archive-cache> <archived-actor-manifest.json>",
  );
const manifestBytes = await Bun.file(manifestFile).bytes(),
  manifest = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
  );
if (
  manifest.schema !== 1 ||
  manifest.kind !== "archived-original-actor-assets" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e"
)
  throw Error("Exact original archived actor manifest required");
const { out, sourceCache, cache } = await createStaticPreparationOutput(
  sourceArg,
  cacheArg,
  { prefix: "actor-bins-", directory: "actor-bins" },
);
const source = await openArchivedActorSources({
    parserCheckout,
    sourceCache,
    archiveCache: cache,
  }),
  records = [],
  written = new Set(),
  tools = {};
await mkdir(path.join(out, "bins"));
for (const file of [
  "export-archived-actor-bins.mjs",
  "archived-actor-sources.mjs",
  "archived-actor-bin.mjs",
  "archived-actor-native-maps.mjs",
  "exact-map-bin.mjs",
  "wad.mjs",
  "rman-chunks.mjs",
  "map-scene-output.mjs",
  "map-scene-assets.mjs",
])
  tools[file] = actorSha256(
    await Bun.file(new URL(file, import.meta.url)).bytes(),
  );
for (const [role, assets] of [
  ["champion", manifest.champions],
  ["world", manifest.worldAssets],
])
  for (const [key, asset] of Object.entries(assets)) {
    if (
      typeof asset.source?.wad !== "string" ||
      !Array.isArray(asset.source.bins)
    )
      throw Error("Original actor BIN source inventory required");
    for (const bin of asset.source.bins) {
      if (!/^[a-f\d]{64}$/.test(bin.sha256))
        throw Error("Original actor BIN digest required");
      const bytes = await source.read(asset.source.wad, bin.path);
      if (actorSha256(bytes) !== bin.sha256)
        throw Error(
          "Original actor BIN differs from immutable actor preparation",
        );
      const tree = readExactMapBin(bytes, manifest.build, {
        captureFieldSpans: true,
      });
      if (!written.has(bin.sha256)) {
        await Bun.write(path.join(out, "bins", `${bin.sha256}.bin`), bytes);
        await Bun.write(
          path.join(out, "bins", `${bin.sha256}.typed.json`),
          JSON.stringify(tree),
        );
        written.add(bin.sha256);
      }
      records.push({
        role,
        actor: key,
        character: asset.character,
        skinId: asset.skinId,
        wad: asset.source.wad,
        file: bin.path,
        sourceSha256: bin.sha256,
        raw: `bins/${bin.sha256}.bin`,
        typed: `bins/${bin.sha256}.typed.json`,
        objects: tree.objects.map((node) => ({
          pathHash: node.pathHash,
          classHash: node.classHash,
        })),
      });
    }
  }
for (const [file, digest] of Object.entries(tools))
  if (
    actorSha256(await Bun.file(new URL(file, import.meta.url)).bytes()) !==
    digest
  )
    throw Error(`Actor BIN export source changed: ${file}`);
await Bun.write(
  path.join(out, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      kind: "archived-original-actor-bin-sources",
      build: manifest.build,
      protocol: manifest.protocol,
      actorManifestSha256: actorSha256(manifestBytes),
      records,
      tools,
      provenance: source.provenance(),
      rmanReceipts: source.receipts(),
      spectatorAdmission: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: out,
    actors:
      Object.keys(manifest.champions).length +
      Object.keys(manifest.worldAssets).length,
    uniqueBins: written.size,
    references: records.length,
    spectatorAdmission: false,
  }),
);
