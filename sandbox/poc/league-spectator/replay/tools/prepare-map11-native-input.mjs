// Bridge exact original BIN field spans to the original native typed readers.
import { resolve } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
const [sourceArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun prepare-map11-native-input.mjs <archived-world-source-dir> <output.json>",
  );
const source = resolve(sourceArg),
  manifestBytes = await Bun.file(
    `${source}/world-source-manifest.json`,
  ).bytes();
const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
if (
  manifest.kind !== "archived-map11-world-source" ||
  manifest.releaseManifestId !== "B499FB04B1158CF6" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e"
)
  throw Error("Original archived Map11 world source required");
const file = `${source}/map-definition.bin`,
  bytes = await Bun.file(file).bytes();
const receipt = manifest.sources.find(
  (entry) => entry.path === "data/maps/shipping/map11/map11.bin",
);
if (!receipt || receipt.sha256 !== sha(bytes) || receipt.bytes !== bytes.length)
  throw Error("Original Map11 BIN source receipt differs");
const tree = readExactMapBin(bytes, manifest.build, {
  captureFieldSpans: true,
});
const classes = new Set([mapBinHash("Map"), mapBinHash("MapSkin")]);
const roots = tree.objects
  .filter((node) => classes.has(node.classHash))
  .map((node) => ({
    identity: Number.parseInt(node.pathHash, 16),
    typeHash: Number.parseInt(node.classHash, 16),
    typeName: node.classHash === mapBinHash("Map") ? "Map" : "MapSkin",
    name: node.fields[mapBinHash("name")]?.value ?? null,
    fields: node.fieldSpans.map((span) => ({
      ...span,
      sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
    })),
  }));
if (
  roots.filter((root) => root.typeName === "Map").length !== 1 ||
  roots.filter((root) => root.name === "Default").length !== 1
)
  throw Error("Unique original Map and Default MapSkin required");
const containerFile = `${source}/materials.bin`,
  containerBytes = await Bun.file(containerFile).bytes();
const containerReceipt = manifest.sources.find(
  (entry) =>
    entry.path === "data/maps/mapgeometry/map11/base_srx.materials.bin",
);
if (
  !containerReceipt ||
  containerReceipt.sha256 !== sha(containerBytes) ||
  containerReceipt.bytes !== containerBytes.length
)
  throw Error("Original MapContainer source receipt differs");
const containerTree = readExactMapBin(containerBytes, manifest.build, {
  captureFieldSpans: true,
});
const containers = containerTree.objects.filter(
  (node) => node.classHash === mapBinHash("MapContainer"),
);
if (containers.length !== 1)
  throw Error("Unique original map container required");
const container = containers[0];
const componentInput = container.fields[mapBinHash("components")].elements.map(
  (component, index) => ({
    index,
    typeHash: Number.parseInt(component.classHash, 16),
    fields: (component.fieldSpans ?? []).map((span) => ({
      ...span,
      sha256: sha(
        containerBytes.subarray(span.offset, span.offset + span.bytes),
      ),
    })),
  }),
);
await Bun.write(
  outputArg,
  JSON.stringify(
    {
      schema: 1,
      build: manifest.build,
      protocol: manifest.protocol,
      kind: "original-map11-native-field-input",
      mapId: 11,
      sourceManifestSha256: sha(manifestBytes),
      source: { file, sha256: sha(bytes), bytes: bytes.length },
      roots,
      containerSource: {
        file: containerFile,
        sha256: sha(containerBytes),
        bytes: containerBytes.length,
      },
      container: {
        identity: Number.parseInt(container.pathHash, 16),
        typeHash: Number.parseInt(container.classHash, 16),
        components: componentInput,
      },
      preparerSha256: sha(await Bun.file(import.meta.path).arrayBuffer()),
      readerSha256: sha(
        await Bun.file(
          new URL("./exact-map-bin.mjs", import.meta.url),
        ).arrayBuffer(),
      ),
      scope: {
        containsReplayEvents: false,
        nativeReadersExecuted: false,
        assetReadinessVerified: false,
      },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output: resolve(outputArg),
    roots: roots.length,
    fields: roots.reduce((sum, root) => sum + root.fields.length, 0),
  }),
);
