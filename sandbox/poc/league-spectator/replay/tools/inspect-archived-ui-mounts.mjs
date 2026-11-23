import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { actorSha256 } from "./archived-actor-sources.mjs";
import { MAP11_RELEASE_SHA256 } from "./map-scene-assets.mjs";

const [parserCheckout, archiveCache, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-archived-ui-mounts.mjs <parser-checkout> <exact-archive-cache> <output.json>",
  );
const release = await Bun.file(
    resolve(archiveCache, "release.manifest"),
  ).bytes(),
  parserPath = resolve(parserCheckout, "src/rman.js");
if (actorSha256(release) !== MAP11_RELEASE_SHA256)
  throw Error("Exact16.21 RMAN release required");
const { parseRman } = await import(pathToFileURL(parserPath).href),
  manifest = parseRman(release);
if (manifest.manifestId !== "B499FB04B1158CF6")
  throw Error("Original RMAN identity differs");
const files = manifest.files
  .filter((file) =>
    /font|(?:^|\/)(?:global|ui)(?:\.|\/)|\.en_us\./i.test(file.name),
  )
  .map((file) => ({
    name: file.name,
    size: file.size,
    link: file.link,
    flags: file.flags,
    chunks: file.chunks.length,
  }));
const report = {
  schema: 1,
  releaseSha256: MAP11_RELEASE_SHA256,
  parserSha256: actorSha256(await Bun.file(parserPath).bytes()),
  files,
  scope:
    "Original archived RMAN mount/file inventory only; no guessed WAD paths or asset substitutions",
};
await Bun.write(outputPath, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    outputPath,
    files: files.length,
    mounts: files
      .filter((file) => /\.wad\.client$/i.test(file.name))
      .map((file) => ({ name: file.name, size: file.size })),
  }),
);
