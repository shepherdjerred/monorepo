import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";
import {
  readActorMetaNames,
  normalizeActorBin,
  ACTOR_META_SOURCE_SHA256,
} from "./archived-actor-bin.mjs";
const [sourceCache, baseLinksPath, textureLinksPath, output] =
  process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun map-native-hud-resource-links.mjs <approved-source-cache> <UI-base-links.json> <texture-links.json> <output.json>",
  );
const metadata = await Bun.file(
  path.join(
    sourceCache,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
).bytes();
if ((await sha256(metadata)) !== ACTOR_META_SOURCE_SHA256)
  throw Error("Pinned original metadata annotations changed");
const names = readActorMetaNames(new TextDecoder().decode(metadata));
const baseBytes = await Bun.file(baseLinksPath).bytes(),
  textureBytes = await Bun.file(textureLinksPath).bytes(),
  bases = JSON.parse(new TextDecoder().decode(baseBytes)),
  textures = JSON.parse(new TextDecoder().decode(textureBytes)),
  textureMap = new Map(textures.results.map((entry) => [entry.value, entry])),
  rows = [],
  scenes = [];
for (const base of bases.results)
  for (const location of base.locations) {
    if (!location.normalizedPath) continue;
    const bytes = await Bun.file(
        path.join(path.dirname(baseLinksPath), location.normalizedPath),
      ).bytes(),
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    const source = await Bun.file(
      path.join(path.dirname(baseLinksPath), location.filename),
    ).bytes();
    if (
      (await sha256(source)) !== location.sha256 ||
      source.length !== location.bytes
    )
      throw Error("Original HUD source bytes changed");
    const tree = readExactMapBin(source, "16.21.829.8620");
    if (
      JSON.stringify(parsed) !==
      JSON.stringify({ tree, normalized: normalizeActorBin(tree, names, []) })
    )
      throw Error("Original HUD normalized derivation changed");
    for (const [hash, value] of Object.entries(parsed.normalized)) {
      if (value.__type === "UISceneData")
        scenes.push({
          baseHash: base.value,
          objectHash: hash,
          original: value,
        });
      function visit(child, fields) {
        if (!child || typeof child !== "object") return;
        if (child.kind === "wad-path-hash") {
          const found = textureMap.get(child.value);
          rows.push({
            baseHash: base.value,
            sourceSha256: location.sha256,
            objectHash: hash,
            objectType: value.__type,
            fields,
            reference: child,
            textureLocations: found?.locations ?? [],
          });
        }
        for (const [field, nested] of Object.entries(child))
          visit(nested, [...fields, field]);
      }
      visit(value, []);
    }
  }
const missing = rows.filter((row) => !row.textureLocations.length);
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      baseLinksSha256: await sha256(baseBytes),
      textureLinksSha256: await sha256(textureBytes),
      scenes,
      rows,
      missing,
      scope:
        "Original typed UI-base resource references and exact WAD lookup results; unresolved links remain unresolved, without path/texture substitutes",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    scenes: scenes.length,
    references: rows.length,
    missing: missing.map(({ objectHash, objectType, fields, reference }) => ({
      objectHash,
      objectType,
      fields,
      reference,
    })),
  }),
);
