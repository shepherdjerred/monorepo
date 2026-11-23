import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { bindLatestMinions } from "../latest-world.mjs";
import {
  createLatestCorpsePolicy,
  createLatestMinionCorpsePlayback,
} from "../latest-corpse.mjs";

const [reportPath, assetRoot, outputPath] = process.argv.slice(2);
if (!outputPath)
  throw Error(
    "Usage: bun inspect-visible-actor-lifetimes.mjs <full-semantic-report.json> <exact-public-assets> <output.json>",
  );
const wanted = new Set([
  "build",
  "protocol",
  "endTime",
  "corpsePolicyPackageSha256",
  "worldEvents",
  "worldEntities",
  "lifecycle",
  "casts",
  "corpseDeathStates",
]);
// Index top-level JSON value byte ranges without retaining the gigabyte-scale
// diagnostic trace. Every selected array below remains complete and unfiltered.
const ranges = new Map(),
  hash = createHash("sha256");
let depth = 0,
  inString = false,
  escaped = false,
  captureKey = false,
  expectKey = false,
  awaitValue = false,
  key = "",
  start = -1,
  position = 0;
function finish(end) {
  if (start >= 0 && wanted.has(key)) ranges.set(key, [start, end]);
  start = -1;
}
for await (const bytes of Bun.file(reportPath).stream()) {
  hash.update(bytes);
  for (const byte of bytes) {
    const at = position++;
    if (inString) {
      if (escaped) {
        escaped = false;
        if (captureKey) key += String.fromCharCode(byte);
        continue;
      }
      if (byte === 92) {
        escaped = true;
        continue;
      }
      if (byte === 34) {
        inString = false;
        captureKey = false;
        continue;
      }
      if (captureKey) key += String.fromCharCode(byte);
      continue;
    }
    if ([32, 10, 13, 9].includes(byte)) continue;
    if (awaitValue) {
      start = at;
      awaitValue = false;
    }
    if (byte === 34) {
      inString = true;
      if (depth === 1 && expectKey) {
        key = "";
        captureKey = true;
        expectKey = false;
      }
    } else if (byte === 58 && depth === 1) awaitValue = true;
    else if (byte === 123 || byte === 91) {
      depth++;
      if (depth === 1) expectKey = true;
    } else if (byte === 125 || byte === 93) {
      if (depth === 1) finish(at);
      depth--;
    } else if (byte === 44 && depth === 1) {
      finish(at);
      expectKey = true;
    }
  }
}
if (depth || inString || ranges.size !== wanted.size)
  throw Error("Incomplete full-match lifecycle report");
const report = {};
for (const [name, [from, to]] of ranges)
  report[name] = JSON.parse(await Bun.file(reportPath).slice(from, to).text());
const bytes = async (path) =>
    new Uint8Array(await Bun.file(resolve(assetRoot, path)).arrayBuffer()),
  sceneBytes = await bytes("latest-scene/manifest.json"),
  worldBytes = await bytes("latest-scene/world.json"),
  policy = await createLatestCorpsePolicy(
    await Bun.file(
      resolve(assetRoot, "decoder-16.21-macos/profile.json"),
    ).json(),
    sceneBytes,
    worldBytes,
    await bytes("latest-corpse/package.json"),
  ),
  bindings = bindLatestMinions(
    report,
    JSON.parse(new TextDecoder().decode(sceneBytes)),
    JSON.parse(new TextDecoder().decode(worldBytes)),
  ),
  playback = createLatestMinionCorpsePlayback(report, policy, bindings),
  // Visibility can increase only at an observed spawn or respawn. Death retains
  // the same instance; the native corpse predicate can only retire it afterwards.
  times = [
    ...new Set([
      0,
      report.endTime,
      ...bindings.minions.map((entry) => entry.event.time),
      ...report.lifecycle
        .filter((event) => event.kind === "respawn-candidate")
        .map((event) => event.time),
    ]),
  ].sort((a, b) => a - b);
let peak = 0,
  peakTime = 0;
for (const time of times) {
  let visible = 0;
  for (const entry of bindings.minions)
    if (playback.sample(entry.event.entityId, time).visible) visible++;
  if (visible > peak) {
    peak = visible;
    peakTime = time;
  }
}
const result = {
  status: "passed",
  scope:
    "Exact existing native corpse/lifecycle predicate over all admitted lane-minion records; no GPU or full-browser acceptance",
  reportSha256: hash.digest("hex"),
  reportBytes: position,
  durationSeconds: report.endTime,
  minionRecords: bindings.minions.length,
  uniqueAssetDescriptors: new Set(
    bindings.minions.map((entry) => JSON.stringify(entry.asset)),
  ).size,
  increasingVisibilityBoundaries: times.length,
  peakVisibleInstances: peak,
  peakTime,
  retainedWholeMatchRecords: true,
};
await Bun.write(outputPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
