import path from "node:path";
import { mkdir } from "node:fs/promises";
import {
  openArchivedActorSources,
  actorSha256,
} from "./archived-actor-sources.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";

const [parserCheckout, sourceCache, archiveCache, hudPath, outputArgument] =
  process.argv.slice(2);
if (!outputArgument || process.argv.length !== 7)
  throw Error(
    "Usage: bun inspect-archived-hud-links.mjs <parser-checkout> <approved-source-cache> <archive-cache> <hud.json> <output-directory>",
  );
const output = path.resolve(outputArgument);
await mkdir(output, { recursive: true });
const source = await openArchivedActorSources({
  parserCheckout,
  sourceCache,
  archiveCache,
});
const metadata = await Bun.file(
  path.join(
    sourceCache,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
).bytes();
if (actorSha256(metadata) !== source.toolchain.metadataNamesSha256)
  throw Error("Pinned metadata annotations changed");
const names = readActorMetaNames(
  new TextDecoder("utf-8", { fatal: true }).decode(metadata),
);
const hud = await Bun.file(hudPath).json(),
  results = [];
const mounts = hud.wadMounts ?? [
  "DATA/FINAL/UI.wad.client",
  "DATA/FINAL/Global.wad.client",
];
if (
  !Array.isArray(mounts) ||
  !mounts.length ||
  mounts.length > 16 ||
  new Set(mounts).size !== mounts.length ||
  mounts.some(
    (name) => typeof name !== "string" || !name.endsWith(".wad.client"),
  )
)
  throw Error("Explicit original RMAN WAD mount names required");
for (const value of hud.wadHashReferences) {
  const locations = [];
  for (const wad of mounts) {
    let bytes;
    try {
      bytes = await source.read(wad, { kind: "wad-path-hash", value });
    } catch (error) {
      if (error.message.startsWith("Missing WAD path hash ")) continue;
      throw error;
    }
    const sha256 = actorSha256(bytes),
      filename = `${sha256}.bin`,
      magic = String.fromCharCode(...bytes.subarray(0, 4));
    await Bun.write(path.join(output, filename), bytes);
    const entry = {
      wad,
      bytes: bytes.byteLength,
      sha256,
      filename,
      magic,
      headerHex: Buffer.from(bytes.subarray(0, 32)).toString("hex"),
    };
    if (magic === "PROP") {
      const tree = readExactMapBin(bytes, "16.21.829.8620");
      const normalized = normalizeActorBin(tree, names, []);
      const normalizedPath = `${sha256}.json`;
      await Bun.write(
        path.join(output, normalizedPath),
        JSON.stringify({ tree, normalized }, null, 2),
      );
      Object.assign(entry, {
        normalizedPath,
        dependencies: tree.dependencies,
        objects: tree.objects.length,
      });
    }
    locations.push(entry);
  }
  results.push({
    value,
    hashHex: BigInt(value).toString(16).padStart(16, "0"),
    locations,
  });
  console.error(JSON.stringify(results.at(-1)));
}
const report = {
  schema: 1,
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  results,
  provenance: source.provenance(),
  rmanReceipts: source.receipts(),
  toolchain: source.toolchain,
  scope: {
    originalHashLinksRead: true,
    missingDefaultsInvented: false,
    nativeLayoutRendered: false,
  },
};
await Bun.write(
  path.join(output, "links.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    output,
    links: results.length,
    found: results.filter((entry) => entry.locations.length).length,
  }),
);
