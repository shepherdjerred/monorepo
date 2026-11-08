// Compare two coordinate interpretations against independent next-path anchors.
// A lower residual supports a candidate; it is not reference-playback validation.
import { createLatestFieldReader } from "../latest-fields.mjs";
import { sampleMovement } from "../playback.mjs";
import { sha256 } from "../structural-comparison.mjs";

const [profilePath, codecPath, corpusPath, oraclePath, outputPath] =
  process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun tools/measure-movement-deltas.mjs <profile.json> <field-codecs.json> <corpus.json> <native-oracle.json> <output.json>",
  );
const profile = await Bun.file(profilePath).json(),
  codecBytes = await Bun.file(codecPath).arrayBuffer();
if ((await sha256(codecBytes)) !== profile.fieldCodecsSha256)
  throw Error("Field-codec integrity failure");
const fields = createLatestFieldReader(
  profile,
  JSON.parse(new TextDecoder().decode(codecBytes)),
);
const corpus = await Bun.file(corpusPath).json(),
  oracle = await Bun.file(oraclePath).json(),
  tracks = new Map();
if (
  corpus.build !== profile.clientVersion ||
  corpus.protocol !== profile.protocolDigest ||
  oracle.decoderImageSha256 !== profile.decoderImageSha256 ||
  oracle.constructorImageSha256 !== profile.constructorImageSha256
)
  throw Error("Measurement source mismatch");
for (const [id, sample] of Object.entries(corpus.packets)) {
  if (sample.opcode !== 657) continue;
  const expected = oracle.observations[id];
  if (
    expected?.status !== "complete" ||
    expected.opcode !== 657 ||
    expected.param !== sample.param ||
    expected.payloadSha256 !==
      (await sha256(Buffer.from(sample.payloadHex, "hex")))
  )
    throw Error(`Incomplete measurement input ${id}`);
  const observation = {
    complete: true,
    object: Buffer.from(expected.object, "hex"),
    heap: Buffer.from(expected.heap, "hex"),
  };
  const signed = fields.movement(observation, "signed8"),
    unsigned = fields.movement(observation, "unsigned8");
  for (let i = 0; i < signed.length; i++) {
    const a = signed[i],
      b = unsigned[i];
    if (!tracks.has(a.entityId)) tracks.set(a.entityId, []);
    tracks.get(a.entityId).push({
      time: sample.time,
      speed: a.speed,
      signed: a.encodedWaypoints.map((p) => p.map((v) => v * 2)),
      unsigned: b.encodedWaypoints.map((p) => p.map((v) => v * 2)),
      differs:
        JSON.stringify(a.encodedWaypoints) !==
        JSON.stringify(b.encodedWaypoints),
    });
  }
}
const residuals = { signed: [], unsigned: [] };
let signedWins = 0,
  unsignedWins = 0;
for (const track of tracks.values()) {
  track.sort((a, b) => a.time - b.time);
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i],
      b = track[i + 1],
      elapsed = b.time - a.time;
    if (!a.differs || elapsed <= 0 || elapsed > 0.5) continue;
    const values = {};
    for (const mode of ["signed", "unsigned"]) {
      const predicted = sampleMovement(
        [{ time: a.time, speed: a.speed, waypoints: a[mode] }],
        b.time,
      ).point;
      values[mode] = Math.hypot(
        predicted[0] - b.signed[0][0],
        predicted[1] - b.signed[0][1],
      );
      residuals[mode].push(values[mode]);
    }
    if (values.signed + 1 < values.unsigned) signedWins++;
    if (values.unsigned + 1 < values.signed) unsignedWins++;
  }
}
if (!residuals.signed.length)
  throw Error("No discriminating movement pairs within 0.5 seconds");
const metrics = Object.fromEntries(
  Object.entries(residuals).map(([mode, values]) => {
    values.sort((a, b) => a - b);
    return [
      mode,
      {
        comparisons: values.length,
        median: values[Math.floor(values.length * 0.5)],
        p90: values[Math.floor(values.length * 0.9)],
        mean: values.reduce((a, b) => a + b, 0) / values.length,
      },
    ];
  }),
);
const report = {
  schema: 1,
  status: "continuity-evidence-only",
  replaySha256: corpus.replaySha256,
  metrics,
  signedWins,
  unsignedWins,
};
await Bun.write(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
