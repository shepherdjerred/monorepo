// Local research verification. The server exposes only the supplied local inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../transport.mjs";
import { decodeReplayObservations } from "../../../../../packages/scout-for-lol/packages/replay/src/observations/decode.mjs";

const args = process.argv.slice(2);
const preparedMode = args[0] === "--prepared";
if (preparedMode) args.shift();
const [replayPath, decompressorPath, sampleArgument, ...extra] = args;
if (!replayPath || !decompressorPath || extra.length)
  throw Error(
    "Usage: bun verify-browser-replay-seek.mjs [--prepared] <replay.rofl> <fzstd.mjs> [seconds[,seconds...]]",
  );

const bytes = new Uint8Array(await readFile(replayPath));
const replay = openReplay(bytes.buffer);
const original = createHash("sha256").update(bytes).digest("hex");
const sampleTimes =
  sampleArgument === undefined
    ? [
        ...[0.1, 0.5, 0.98].map((fraction) => replay.duration * fraction),
        replay.duration,
      ]
    : sampleArgument
        .split(",")
        .map((token) => (token.trim() ? Number(token) : NaN));
if (
  sampleTimes.length > 12 ||
  sampleTimes.some(
    (time, index) =>
      !Number.isFinite(time) ||
      time < 0 ||
      time > replay.duration ||
      (index > 0 && time <= sampleTimes[index - 1]),
  )
)
  throw Error(
    "Choose up to 12 increasing sample times within the replay duration",
  );

const packetFields = [
  "chunkId",
  "chunkOffset",
  "storedChunkBytes",
  "stream",
  "blockOffset",
  "marker",
  "firstTimeBits",
  "secondTimeBits",
  "explicitOpcode",
  "paramBits",
  "timeSeconds",
];
const windows = sampleTimes.map((time) => ({ time, anchor: null }));
const nodeDecompress = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.length });
const digestJson = (data) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const work = [];
const snapshots = [];
let opcode;
let context;
let indexed = 0;
// The reference scans the entire file sequentially and replaces each expected
// window on encountering a later qualifying snapshot. It never calls seek.
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, (input, target) => {
    if (preparedMode)
      work.push([input.byteOffset, input.byteLength, target.byteLength]);
    return nodeDecompress(input, target);
  }),
)) {
  const snapshotStart = packet.stream === 2 && packet.blockOffset === 0;
  if (snapshotStart) indexed++;
  if (preparedMode && packet.stream === 2) {
    if (snapshotStart) {
      snapshots.push({ time: packet.timeSeconds, markers: new Map() });
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (opcode === 1012 && packet.payload.length === 41) {
      const { markers } = snapshots.at(-1);
      const alive = Boolean(packet.payload[13] & 8);
      markers.set(
        context,
        markers.has(context) && markers.get(context) !== alive ? null : alive,
      );
    }
  }
  for (const window of windows) {
    if (packet.timeSeconds > window.time) continue;
    if (snapshotStart) {
      window.anchor = {
        id: packet.chunkId,
        offset: packet.chunkOffset,
        clock: packet.timeSeconds,
      };
      window.count = 0;
      window.last = null;
      window.streams = {};
      window.hash = createHash("sha256");
    }
    const anchor = window.anchor;
    if (
      !anchor ||
      !(
        (packet.stream === 2 && packet.chunkOffset === anchor.offset) ||
        (packet.stream === 1 && packet.chunkOffset > anchor.offset)
      )
    )
      continue;
    window.hash.update(
      JSON.stringify(
        packetFields
          .map((field) => packet[field])
          .concat(packet.payload.length),
      ),
    );
    window.hash.update(packet.payload);
    window.count++;
    window.last = packet.timeSeconds;
    window.streams[packet.stream] = (window.streams[packet.stream] ?? 0) + 1;
  }
}
const expected = windows.map(({ hash, ...window }) => {
  assert.ok(window.anchor, "No reference snapshot at the requested time");
  return { ...window, digest: hash.digest("hex") };
});
const observations = preparedMode
  ? decodeReplayObservations(bytes.buffer, nodeDecompress)
  : null;
const losses = observations?.turrets ?? [];
const turretTimes = new Set();
if (losses.length) {
  const firstLoss = Math.min(...losses.map((loss) => loss.timeSeconds));
  for (const shift of [-0.001, 0, 0.001]) turretTimes.add(firstLoss + shift);
  const missing = snapshots.find(({ time, markers }) =>
    losses.some(
      (loss) => time < loss.timeSeconds && !markers.has(loss.context),
    ),
  );
  if (missing) turretTimes.add(missing.time);
} else if (preparedMode) {
  turretTimes.add(0);
  turretTimes.add(replay.duration);
}
const expectedTurrets = [...turretTimes]
  .sort((a, b) => a - b)
  .map((time) => {
    if (observations.turrets === null) return null;
    const snapshot = snapshots.findLast((snapshot) => snapshot.time <= time);
    const turrets = losses.map((loss) => {
      const { context, defendingPartition } = loss;
      const marker = snapshot.markers.get(context);
      assert.notEqual(marker, null, "Conflicting turret marker in reference");
      if (marker !== undefined && snapshot.time !== loss.timeSeconds)
        assert.equal(marker, snapshot.time < loss.timeSeconds);
      const keyframeState =
        snapshot.time === loss.timeSeconds
          ? "unknown-same-time"
          : marker === undefined
            ? "unknown-missing"
            : marker
              ? "alive"
              : "dead";
      return {
        context,
        defendingPartition,
        keyframeState,
        seekState: time < loss.timeSeconds ? "alive" : "dead",
      };
    });
    return { keyframeTimeSeconds: snapshot.time, turrets };
  });

const build = await Bun.build({
  entrypoints: [
    fileURLToPath(
      new URL(
        "../../../../../packages/scout-for-lol/packages/replay/src/packets.ts",
        import.meta.url,
      ),
    ),
    ...(preparedMode
      ? [
          fileURLToPath(
            new URL(
              "../../../../../packages/scout-for-lol/packages/replay/src/prepare.ts",
              import.meta.url,
            ),
          ),
        ]
      : []),
  ],
  target: "browser",
  format: "esm",
  naming: "[name].mjs",
});
assert.ok(build.success, build.logs.map(({ message }) => message).join("\n"));
const modules = new Map(
  await Promise.all(
    build.outputs.map(async (output) => [
      `/${basename(output.path)}`,
      await output.text(),
    ]),
  ),
);
modules.set("/fzstd.mjs", await readFile(decompressorPath, "utf8"));
const require = createRequire(
  new URL(
    "../../../../../packages/scout-for-lol/packages/app/package.json",
    import.meta.url,
  ),
);
const { chromium } = require("@playwright/test");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/original.rofl") return new Response(bytes);
    if (path === "/")
      return new Response("<title>Replay transport check</title>", {
        headers: { "Content-Type": "text/html" },
      });
    if (modules.has(path))
      return new Response(modules.get(path), {
        headers: { "Content-Type": "text/javascript" },
      });
    return new Response(null, { status: 404 });
  },
});

let browser;
try {
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === server.url.origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(server.url.href);
  const actual = await page.evaluate(
    async ({ sampleTimes, packetFields, preparedMode, turretTimes }) => {
      const { createReplayPacketReader } = await import("/packets.mjs");
      const { decompress } = await import("/fzstd.mjs");
      const response = await fetch("/original.rofl");
      if (!response.ok) throw Error("Could not fetch the loopback replay");
      const bytes = await response.arrayBuffer();
      const sha = async (input) =>
        Array.from(
          new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("");
      const indexStart = performance.now();
      const work = [];
      const expand = (input, target) => {
        if (preparedMode)
          work.push([input.byteOffset, input.byteLength, target.byteLength]);
        return decompress(input, target);
      };
      const prepared = preparedMode
        ? (await import("/prepare.mjs")).prepareReplayForSeek(bytes, expand)
        : null;
      const reader =
        prepared?.packetReader ?? createReplayPacketReader(bytes, expand);
      const index = reader.keyframes;
      const keyframeIndexMilliseconds = performance.now() - indexStart;
      const initWork = work.splice(0);
      const encoder = new TextEncoder();
      const hashJson = (data) => sha(encoder.encode(JSON.stringify(data)));
      const cases = [];
      const seekWindows = [];
      for (const time of sampleTimes) {
        const seekStart = performance.now();
        let timedCount = 0;
        for (const _ of reader.read(time).packets) timedCount++;
        const elapsedMilliseconds = performance.now() - seekStart;
        const { keyframe, packets } = reader.read(time);
        const workStart = work.length;
        const chunks = [];
        const streams = {};
        let count = 0;
        let last = null;
        for (const packet of packets) {
          const fields = packetFields
            .map((field) => packet[field])
            .concat(packet.payload.length);
          chunks.push(encoder.encode(JSON.stringify(fields)), packet.payload);
          count++;
          last = packet.timeSeconds;
          streams[packet.stream] = (streams[packet.stream] ?? 0) + 1;
        }
        if (timedCount !== count)
          throw Error("Timed seek packet count differs");
        const seekWork = work.slice(workStart);
        if (
          new Set(seekWork.map(([offset]) => offset)).size !== seekWork.length
        )
          throw Error("Repeated chunk decompression within one seek");
        seekWindows.push({
          time,
          elapsedMilliseconds,
          ...(preparedMode
            ? {
                decompressions: seekWork.length,
                expandedBytes: seekWork.reduce(
                  (size, [, , length]) => size + length,
                  0,
                ),
              }
            : {}),
        });
        const anchor = {
          id: keyframe.chunkId,
          offset: keyframe.chunkOffset,
          clock: keyframe.timeSeconds,
        };
        cases.push({
          time,
          anchor,
          count,
          last,
          streams,
          digest: await sha(await new Blob(chunks).arrayBuffer()),
        });
      }
      const abort = new AbortController();
      const cancelled = reader.read(sampleTimes[0], {
        signal: abort.signal,
      }).packets;
      if (cancelled.next().done)
        throw Error("Cancellation control needs an original packet");
      const reason = new DOMException("Owned seek cancelled", "AbortError");
      abort.abort(reason);
      let abortReasonPreserved = false;
      try {
        cancelled.next();
      } catch (error) {
        abortReasonPreserved = error === reason;
      }
      if (!abortReasonPreserved)
        throw Error("Seek cancellation lost its original reason");
      if (
        !Object.isFrozen(reader.keyframes) ||
        !reader.keyframes.every(Object.isFrozen)
      )
        throw Error(
          "Published keyframe metadata must not mutate the owned index",
        );
      const { build, protocol } = reader;
      let preparedParity = null;
      if (prepared) {
        const before = work.length;
        const turretStates = turretTimes.map((time) =>
          prepared.readTurretState(time),
        );
        if (work.length !== before)
          throw Error("Prepared turret seek unexpectedly decompressed a chunk");
        preparedParity = {
          observations: await hashJson(prepared.observations),
          workDigest: await hashJson(initWork),
          decompressions: initWork.length,
          inputBytes: initWork.reduce((size, [, length]) => size + length, 0),
          expandedBytes: initWork.reduce(
            (size, [, , length]) => size + length,
            0,
          ),
          turretStates,
        };
      }
      return {
        original: await sha(bytes),
        build,
        protocol,
        indexed: index.length,
        cases,
        preparedParity,
        browserTiming: { keyframeIndexMilliseconds, seekWindows },
        ownership: {
          abortReasonPreserved,
          metadataFrozen: true,
          originalBufferRetained: bytes.byteLength > 0,
        },
      };
    },
    {
      sampleTimes,
      packetFields,
      preparedMode,
      turretTimes: [...turretTimes].sort((a, b) => a - b),
    },
  );
  assert.deepEqual(errors, []);
  const { browserTiming, ownership, preparedParity, ...parity } = actual;
  assert.deepEqual(parity, {
    original,
    build: replay.build,
    protocol: replay.protocol,
    indexed,
    cases: expected,
  });
  let preparedEvidence;
  if (preparedMode) {
    const { turretStates, ...preparation } = preparedParity;
    assert.deepEqual(preparation, {
      observations: digestJson(observations),
      workDigest: digestJson(work),
      decompressions: work.length,
      inputBytes: work.reduce((size, [, length]) => size + length, 0),
      expandedBytes: work.reduce((size, [, , length]) => size + length, 0),
    });
    assert.deepEqual(turretStates, expectedTurrets);
    preparedEvidence = {
      ...preparation,
      turretSampleTimes: [...turretTimes].sort((a, b) => a - b),
      turretSeekDecompressions: 0,
      missingMarkerSamples: turretStates.filter((state) =>
        state?.turrets.some(
          ({ keyframeState }) => keyframeState === "unknown-missing",
        ),
      ).length,
    };
  }
  console.log(
    JSON.stringify(
      { ...parity, browserTiming, ownership, preparedEvidence },
      null,
      2,
    ),
  );
} finally {
  try {
    await browser?.close();
  } finally {
    await server.stop(true);
  }
}
