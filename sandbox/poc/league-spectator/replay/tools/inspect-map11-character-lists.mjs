// Original map declarations only; this does not infer selectable champion/skin
// legality from the presence of a WAD, skin file or diagnostic character list.
import path from "node:path";
import { actorSha256 as sha } from "./archived-actor-sources.mjs";
import {
  ACTOR_META_SOURCE_SHA256,
  readActorMetaNames,
  normalizeActorBin,
} from "./archived-actor-bin.mjs";
import { readExactMapBin } from "./exact-map-bin.mjs";

const [sourceArg, mapSourceArg, output] = process.argv.slice(2);
if (!output)
  throw Error(
    "Usage: bun inspect-map11-character-lists.mjs <approved-source-cache> <original-map11-scene> <output.json>",
  );
const metadata = await Bun.file(
  path.join(
    sourceArg,
    "research/LeagueToolkit/src/LeagueToolkit.Meta.Classes/Classes.cs",
  ),
).bytes();
if (sha(metadata) !== ACTOR_META_SOURCE_SHA256)
  throw Error("Pinned metadata source changed");
const bytes = await Bun.file(
    path.join(mapSourceArg, "map-definition.bin"),
  ).bytes(),
  typed = readExactMapBin(bytes, "16.21.829.8620"),
  normalized = normalizeActorBin(
    typed,
    readActorMetaNames(new TextDecoder().decode(metadata)),
  ),
  classes = {},
  candidates = [];
for (const [owner, value] of Object.entries(normalized)) {
  classes[value.__type] = (classes[value.__type] ?? 0) + 1;
  if (/CharacterList|^Map$|^Character$|Champion|Skin/i.test(value.__type))
    candidates.push({ owner, value });
}
await Bun.write(
  output,
  JSON.stringify(
    {
      schema: 1,
      kind: "original-map11-character-declarations",
      sourceSha256: sha(bytes),
      classes,
      candidates,
      selectableRosterAdmitted: false,
      skinLegalityAdmitted: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    output,
    sourceSha256: sha(bytes),
    objects: typed.objects.length,
    candidates: candidates.length,
    classes: Object.fromEntries(
      Object.entries(classes).filter(([name]) =>
        /CharacterList|Champion|Skin/.test(name),
      ),
    ),
    selectableRosterAdmitted: false,
  }),
);
