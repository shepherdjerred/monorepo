import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";

const [parserCheckout, sourceCache, archiveCache, outputArgument] =
  process.argv.slice(2);
if (!outputArgument || process.argv.length !== 6)
  throw Error(
    "Usage: bun inspect-archived-replay-hud.mjs <parser-checkout> <approved-source-cache> <archive-cache> <output-directory>",
  );
const output = path.resolve(outputArgument);
await mkdir(path.join(output, "original"), { recursive: true });
const source = await openArchivedActorSources({
  parserCheckout,
  sourceCache,
  archiveCache,
});
const wadNames = ["DATA/FINAL/UI.wad.client", "DATA/FINAL/Global.wad.client"];
const wads = await Promise.all(
  wadNames.map(async (name) => ({ name, read: await source.wad(name) })),
);
// These are discovery hints only. A match is admitted only by the original WAD
// index and range/digest validation; Toolkit names never supply omitted values.
const names = [
  "replaycontrols",
  "replaycameracontrols",
  "replayvisibilitymenu",
  "spectatorscoreboard",
  "teamframesreplay",
  "lolgameheaderreplay",
  "targetframereplay",
];
const pending = names.flatMap((name) => [
  `gameplay/${name}.uibase.bin`,
  `gameplay.${name}.bin`,
]);
const files = [],
  missing = [],
  visited = new Set();
const classes = new Map(),
  textureReferences = new Set(),
  wadHashReferences = new Set();
function inspect(value) {
  if (Array.isArray(value)) {
    for (const item of value) inspect(item);
    return;
  }
  if (value && typeof value === "object") {
    if (typeof value.__type === "string")
      classes.set(value.__type, (classes.get(value.__type) ?? 0) + 1);
    if (value.kind === "wad-path-hash") wadHashReferences.add(value.value);
    for (const item of Object.values(value)) inspect(item);
  } else if (
    typeof value === "string" &&
    /\.(?:dds|tex|tga|png|sdf)$/i.test(value)
  )
    textureReferences.add(value);
}
while (pending.length) {
  const file = pending.shift().toLowerCase();
  if (visited.has(file)) continue;
  if (visited.size >= 512)
    throw Error("Native HUD BIN dependency closure exceeds512files");
  visited.add(file);
  const locations = wads.filter((wad) => wad.read.has(file));
  if (!locations.length) {
    missing.push(file);
    continue;
  }
  for (const wad of locations) {
    const bytes = await source.read(wad.name, file),
      sha256 = actorSha256(bytes);
    await Bun.write(path.join(output, "original", `${sha256}.bin`), bytes);
    const bin = await source.bin(wad.name, file);
    inspect(bin.normalized);
    const normalizedPath = path.join("original", `${sha256}.json`);
    await Bun.write(
      path.join(output, normalizedPath),
      JSON.stringify(
        {
          file,
          wad: wad.name,
          tree: bin.tree,
          normalized: bin.normalized,
          unsupportedDeclarations: bin.unsupportedDeclarations,
        },
        null,
        2,
      ),
    );
    files.push({
      file,
      wad: wad.name,
      bytes: bytes.byteLength,
      sha256,
      normalizedPath,
      dependencies: bin.tree.dependencies,
      objects: bin.tree.objects.length,
    });
    for (const dependency of bin.tree.dependencies)
      if (!visited.has(dependency.toLowerCase())) pending.push(dependency);
    console.error(
      JSON.stringify({
        file,
        wad: wad.name,
        bytes: bytes.byteLength,
        objects: bin.tree.objects.length,
        dependencies: bin.tree.dependencies.length,
      }),
    );
  }
}
const report = {
  schema: 1,
  kind: "original-archived-replay-hud-definitions",
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  files,
  missing,
  classes: Object.fromEntries(
    [...classes].sort(([left], [right]) => left.localeCompare(right)),
  ),
  textureReferences: [...textureReferences].sort(),
  wadHashReferences: [...wadHashReferences].sort(),
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  toolchain: source.toolchain,
  scope: {
    originalBinDefinitionsRead: true,
    originalDependenciesFollowed: true,
    missingFieldsDefaulted: false,
    runtimeBindingsExecuted: false,
    nativeLayoutRendered: false,
    nativeHudParityEstablished: false,
  },
};
await Bun.write(path.join(output, "hud.json"), JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    output,
    files: files.length,
    missing,
    classes: classes.size,
    textures: textureReferences.size,
    wadHashes: wadHashReferences.size,
  }),
);
