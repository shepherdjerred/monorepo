import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";

const [replayPath, expectedSha256, outputPath, ...extra] =
  process.argv.slice(2);
assert.ok(
  replayPath && outputPath && extra.length === 0,
  "Usage: bun prove-recorded-seek-corpus.mjs <replay.rofl> <reviewed-replay-sha256> <new-private-receipt.json>",
);
assert.match(expectedSha256 ?? "", /^[a-f0-9]{64}$/u);
const output = resolve(outputPath);
const [cache, parent] = await Promise.all([
  realpath(".cache"),
  realpath(dirname(output)),
]);
assert.ok(
  parent === cache || parent.startsWith(cache + sep),
  "Expected private .cache output",
);
const bytes = await readFile(replayPath);
const replaySha256 = createHash("sha256").update(bytes).digest("hex");
assert.equal(replaySha256, expectedSha256, "Original replay digest differs");
const buffer = Uint8Array.from(bytes).buffer;
const decompress = (compressed, target) =>
  zstdDecompressSync(compressed, { maxOutputLength: target.byteLength });
const replay = openReplay(buffer);
assert.equal(replay.protocol, "8bbfcd5af2bc92db");
assert.ok(
  ["16.23.841.3489", "16.23.841.8428"].includes(replay.build),
  "Expected reviewed offline replay build",
);
const { packetReader, observations } = prepareReplayForSeek(
  buffer,
  decompress,
  {
    allowCurrentBuild: true,
  },
);
assert.equal(observations.binding.verified.length, 10);
assert.equal(observations.levels.finalLevels.length, 10);

function windowDigest() {
  const digest = createHash("sha256");
  const header = Buffer.alloc(44);
  let packets = 0;
  let snapshotPackets = 0;
  return {
    add(packet) {
      for (const [index, value] of [
        packet.stream,
        packet.chunkId,
        packet.chunkOffset,
        packet.blockOffset,
        packet.storedChunkBytes,
        packet.marker,
        packet.firstTimeBits,
        packet.secondTimeBits,
        packet.explicitOpcode ?? 0xffffffff,
        packet.paramBits,
        packet.payload.byteLength,
      ].entries())
        header.writeUInt32LE(value, index * 4);
      digest.update(header).update(packet.payload);
      packets++;
      if (packet.stream === 2) snapshotPackets++;
    },
    finish() {
      return { packets, snapshotPackets, sha256: digest.digest("hex") };
    },
  };
}

const expectedWindows = new Map(
  packetReader.keyframes.map((keyframe, index, keyframes) => {
    const end =
      keyframes[index + 1]?.timeSeconds ?? packetReader.durationSeconds;
    const times = [keyframe.timeSeconds, (keyframe.timeSeconds + end) / 2];
    if (index === keyframes.length - 1) times.push(end);
    return [
      keyframe.chunkOffset,
      [...new Set(times)].map((time) => ({
        time,
        keyframe,
        expected: windowDigest(),
      })),
    ];
  }),
);

// Independently reconstruct expected windows from a single chronological
// stream. Compare saved gameplay bytes and selected snapshots in wire order.
let current;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, decompress),
)) {
  if (packet.stream === 2 && packet.blockOffset === 0) {
    current = expectedWindows.get(packet.chunkOffset);
    assert.ok(current, "Sequential traversal found an unindexed snapshot");
    assert.equal(packet.timeSeconds, current[0].keyframe.timeSeconds);
  }
  if (current === undefined || (packet.stream !== 1 && packet.stream !== 2))
    continue;
  for (const { time, expected } of current)
    if (packet.timeSeconds <= time) expected.add(packet);
}

const windows = [];
for (const { time, keyframe, expected } of [...expectedWindows.values()]
  .flat()
  .reverse()) {
  const window = packetReader.read(time);
  assert.deepEqual(window.keyframe, keyframe);
  const actual = windowDigest();
  let first;
  for (const packet of window.packets) {
    first ??= packet;
    assert.ok(packet.timeSeconds <= time);
    actual.add(packet);
  }
  assert.ok(first && first.stream === 2 && first.explicitOpcode === 1167);
  assert.equal(first.chunkOffset, keyframe.chunkOffset);
  assert.equal(first.timeSeconds, keyframe.timeSeconds);
  const verified = actual.finish();
  assert.deepEqual(
    verified,
    expected.finish(),
    `Original seek window differs at ${time}s`,
  );
  windows.push({ time, keyframeTime: keyframe.timeSeconds, ...verified });
}
const controller = new AbortController();
controller.abort();
assert.throws(() => packetReader.read(0, { signal: controller.signal }), {
  name: "AbortError",
});
assert.throws(
  () => packetReader.read(packetReader.durationSeconds + 1),
  /inside the recorded replay duration/,
);
const receipt = {
  schema: 1,
  kind: "recorded-replay-seek-verification",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  durationMilliseconds: packetReader.durationMilliseconds,
  levelEvents: observations.levels.events.length,
  bindings: observations.binding.verified.length,
  keyframes: packetReader.keyframes.length,
  windows,
  scope: "offline-transport-observations-and-raw-seek-only",
};
await writeFile(output, JSON.stringify(receipt) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({
    build: receipt.build,
    keyframes: receipt.keyframes,
    windows: windows.length,
  }),
);
