// Original serialized bounds only: no rendered geometry or nav-grid inference.
import { resolve, join } from "node:path";
import { readExactMapBin } from "./exact-map-bin.mjs";
import { mapBinHash } from "./map-scene-assets.mjs";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
const [sourceArg, outputArg] = process.argv.slice(2);
if (!outputArg)
  throw Error(
    "Usage: bun prepare-map11-fow-input.mjs <archived-world-source> <fresh-output.json>",
  );
if (await Bun.file(outputArg).exists())
  throw Error("Fresh FoW input output required");
const root = resolve(sourceArg),
  sourceFile = join(root, "materials.bin"),
  manifestFile = join(root, "world-source-manifest.json"),
  manifestBytes = await Bun.file(manifestFile).bytes(),
  manifest = JSON.parse(new TextDecoder().decode(manifestBytes)),
  bytes = await Bun.file(sourceFile).bytes(),
  receipt = manifest.sources.find(
    (entry) =>
      entry.path === "data/maps/mapgeometry/map11/base_srx.materials.bin",
  );
if (
  manifest.kind !== "archived-map11-world-source" ||
  manifest.releaseManifestId !== "B499FB04B1158CF6" ||
  manifest.build !== "16.21.829.8620" ||
  manifest.protocol !== "20e09df23c66b85e" ||
  !receipt ||
  receipt.bytes !== bytes.length ||
  receipt.sha256 !== sha(bytes)
)
  throw Error("Exact archived Map11 source and receipt required");
const tree = readExactMapBin(bytes, manifest.build, {
    captureFieldSpans: true,
  }),
  containers = tree.objects.filter(
    (node) => node.classHash === mapBinHash("MapContainer"),
  );
if (containers.length !== 1 || containers[0].pathHash !== "09e8f830")
  throw Error("Unique original Base_SRX MapContainer required");
const object = containers[0],
  minHash = "b14297a4",
  maxHash = "bf563566",
  fields = object.fieldSpans
    .filter((span) => [minHash, maxHash].includes(span.fieldHash))
    .map((span) => ({
      ...span,
      sha256: sha(bytes.subarray(span.offset, span.offset + span.bytes)),
    }));
if (
  fields.length !== 1 ||
  fields[0].fieldHash !== maxHash ||
  Object.hasOwn(object.fields, minHash) ||
  object.fields[maxHash]?.type !== "Vector2"
)
  throw Error("Exact authored max and absent min bounds required");
const inputs = { [manifestFile]: sha(manifestBytes), [sourceFile]: sha(bytes) };
for (const name of [
  "prepare-map11-fow-input.mjs",
  "exact-map-bin.mjs",
  "map-scene-assets.mjs",
  "archived-actor-sources.mjs",
])
  inputs[resolve(import.meta.dir, name)] = sha(
    await Bun.file(new URL(name, import.meta.url)).bytes(),
  );
const result = {
  schema: 1,
  kind: "original-map11-fow-bound-field-input",
  build: manifest.build,
  protocol: manifest.protocol,
  source: { file: sourceFile, bytes: bytes.length, sha256: sha(bytes) },
  object: { pathHash: object.pathHash, classHash: object.classHash },
  fieldIdentities: { minimum: minHash, maximum: maxHash },
  minimumAuthored: false,
  authoredMaximum: object.fields[maxHash].value,
  fields,
  inputs,
  scope: {
    originalSerializedBounds: true,
    geometryBoundsUsed: false,
    navGridBoundsUsed: false,
    nativeDefaultProved: false,
  },
};
for (const [file, digest] of Object.entries(inputs))
  if (sha(await Bun.file(file).bytes()) !== digest)
    throw Error("FoW bound source changed during preparation");
await Bun.write(outputArg, JSON.stringify(result));
console.log(
  JSON.stringify({
    output: outputArg,
    maximum: result.authoredMaximum,
    fields: fields.length,
  }),
);
