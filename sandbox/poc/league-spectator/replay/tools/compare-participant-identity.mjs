import { resolve } from "node:path";
import {
  createLatestParticipantReader,
  bindLatestHeroParticipant,
} from "../latest-participants.mjs";
import { openReplay } from "../transport.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [assetRoot, initialPath, nativePath, replayPath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun compare-participant-identity.mjs <assets> <initial-startup.json> <native.json> <replay.rofl> <output.json>",
  );
const initial = await Bun.file(initialPath).json(),
  native = await Bun.file(nativePath).json(),
  buffer = await Bun.file(replayPath).arrayBuffer();
if (
  initial.replaySha256 !== (await sha256(buffer)) ||
  native.replaySha256 !== initial.replaySha256
)
  throw Error("Original and translated participant inputs differ");
const reader = await createLatestParticipantReader({
  profile: await Bun.file(
    resolve(assetRoot, "decoder-16.21-macos/profile.json"),
  ).json(),
  image: new Uint8Array(
    await Bun.file(
      resolve(assetRoot, "decoder-16.21-macos/image.bin"),
    ).arrayBuffer(),
  ),
});
const participants = reader.read({
  complete: true,
  object: new Uint8Array(
    Buffer.from(initial.startupObservation.objectHex, "hex"),
  ),
  heap: new Uint8Array(Buffer.from(initial.startupObservation.heapHex, "hex")),
});
for (const row of participants) {
  const expected = native.rows.filter(
    (candidate) => candidate.slot === row.slot,
  );
  if (
    expected.length !== 1 ||
    expected[0].identity !== row.summonerId ||
    expected[0].metadataMatches.length !== 1
  )
    throw Error("Translated participant differs from original consumer");
}
const replay = openReplay(buffer);
const heroes = initial.heroes.map((hero) => ({
  ...hero,
  ...bindLatestHeroParticipant(hero, participants, replay),
}));
if (
  heroes.length !== 10 ||
  new Set(heroes.map((hero) => hero.metadataIndex)).size !== 10
)
  throw Error("Original hero identities do not uniquely cover metadata");
await Bun.write(
  outputPath,
  JSON.stringify(
    {
      schema: 1,
      replaySha256: initial.replaySha256,
      matched: participants.length,
      participants,
      heroes,
      scope:
        "Original participant identity slices agree; team and footer identities bind by exact SUMMONER_ID rather than order/champion",
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    matched: participants.length,
    heroes: heroes.length,
    outputPath,
  }),
);
