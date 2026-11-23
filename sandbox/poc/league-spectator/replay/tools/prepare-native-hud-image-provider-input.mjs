import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  readActorMetaNames,
  normalizeActorBin,
  ACTOR_META_SOURCE_SHA256,
} from "./archived-actor-bin.mjs";

const [sourceCache, basePath, resourcesPath, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun prepare-native-hud-image-provider-input.mjs <approved-source-cache> <base-links.json> <image-resources.json> <output.json>",
  );
const metadata = await Bun.file(
  path.join(
    sourceCache,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
).bytes();
if ((await sha256(metadata)) !== ACTOR_META_SOURCE_SHA256)
  throw Error("Original metadata annotations changed");
const names = readActorMetaNames(new TextDecoder().decode(metadata)),
  baseBytes = await Bun.file(basePath).bytes(),
  bases = JSON.parse(new TextDecoder().decode(baseBytes)),
  resourceBytes = await Bun.file(resourcesPath).bytes(),
  resources = JSON.parse(new TextDecoder().decode(resourceBytes)),
  definitions = new Map();
if (resources.sourceReceipts.baseLinks !== (await sha256(baseBytes)))
  throw Error("Original UI-base source receipt changed");
for (const base of bases.results)
  for (const location of base.locations) {
    if (!location.normalizedPath) continue;
    const raw = await Bun.file(
      path.join(path.dirname(basePath), location.filename),
    ).bytes();
    if (
      (await sha256(raw)) !== location.sha256 ||
      raw.length !== location.bytes
    )
      throw Error("Original UI-base WAD bytes changed");
    const normalized = normalizeActorBin(
      readExactMapBin(raw, "16.21.829.8620"),
      names,
      [],
    );
    for (const [objectHash, original] of Object.entries(normalized))
      definitions.set(`${base.value}:${objectHash}`, {
        original,
        sourceSha256: location.sha256,
      });
  }
const providers = resources.images.map((image) => {
  const definition = definitions.get(`${image.baseHash}:${image.objectHash}`);
  if (
    !definition ||
    definition.sourceSha256 !== image.sourceSha256 ||
    image.fields.length < 1
  )
    throw Error("Original image has no unique UI-base owner");
  const original = image.fields
    .slice(0, -1)
    .reduce((value, field) => value?.[field], definition.original);
  if (
    !original ||
    typeof original.__type !== "string" ||
    original[image.fields.at(-1)]?.value !== image.reference.value
  )
    throw Error("Original typed image provider no longer joins its reference");
  return {
    baseHash: image.baseHash,
    objectHash: image.objectHash,
    sourceSha256: image.sourceSha256,
    path: image.fields.slice(0, -1),
    original,
    image: {
      reference: image.reference.value,
      texture: image.texture.reference,
      sourceSha256: image.texture.sourceSha256,
      width: image.texture.width,
      height: image.texture.height,
      atlas: image.atlas,
    },
  };
});
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-ui-image-provider-inputs",
      build: resources.build,
      protocol: resources.protocol,
      sourceReceipts: {
        bases: await sha256(baseBytes),
        images: await sha256(resourceBytes),
        metadata: ACTOR_META_SOURCE_SHA256,
      },
      providers,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    providers: providers.length,
    classes: Object.fromEntries(
      [...new Set(providers.map((row) => row.original.__type))].map((type) => [
        type,
        providers.filter((row) => row.original.__type === type).length,
      ]),
    ),
  }),
);
