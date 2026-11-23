import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { sampleNativeTerrainMotion } from "./research/native-terrain-motion-sample.mjs";

const [workerOrigin, baselineOrigin] = process.argv.slice(2);
assert.ok(
  workerOrigin && baselineOrigin,
  "Usage: node verify-offline-terrain-motion-worker.mjs <worker-loopback-origin> <server-baseline-loopback-origin>",
);
const decoderSha256 =
  "14d1c21833a71917e12ff44a3ae8d9a6c40ee2401d94f0b3824991022c1c124c";
const fixtures = new Map([
  [
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    {
      keyframes: 30,
      markers: 267,
      sampleTimes: [
        0, 24, 60, 238, 240.074, 319.25, 323.75, 806.25, 1063.25, 1757,
      ],
    },
  ],
  [
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    {
      keyframes: 2,
      markers: 20,
      sampleTimes: [0, 5, 24, 50, 60.0298614501953, 70, 76],
    },
  ],
]);

function loopbackOrigin(input) {
  const url = new URL(input);
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.href, url.origin + "/");
  assert.ok(url.port, "An explicit loopback port is required");
  return url;
}

async function route(origin, path) {
  const response = await fetch(new URL(path, origin), {
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, `HTTP failure for ${path}`);
  return response;
}

const sha256 = (bytes) =>
  createHash("sha256").update(new Uint8Array(bytes)).digest("hex");

const origin = loopbackOrigin(workerOrigin);
const reference = loopbackOrigin(baselineOrigin);
const [scene, baseline, workerBytes, replayBytes, decoderBytes] =
  await Promise.all([
    route(origin, "/scene.json").then((response) => response.json()),
    route(reference, "/scene.json").then((response) => response.json()),
    route(origin, "/replay-motion-worker.mjs").then((response) =>
      response.arrayBuffer(),
    ),
    route(origin, "/replay-motion.rofl").then((response) =>
      response.arrayBuffer(),
    ),
    route(origin, "/replay-motion-decoder.bin").then((response) =>
      response.arrayBuffer(),
    ),
  ]);

const { identity, workerMotion } = scene;
assert.deepEqual(identity, baseline.identity);
assert.equal(
  scene.motion,
  undefined,
  "Worker route should omit prepared motion",
);
assert.equal(
  scene.decodedPositionFrames,
  undefined,
  "Worker route should omit prepared positions",
);
assert.equal(baseline.workerMotion, undefined);
assert.equal(identity.build, "16.23.840.6595");
assert.equal(identity.protocol, "8bbfcd5af2bc92db");
const fixture = fixtures.get(identity.replaySha256);
assert.ok(fixture, "Expected a verified replay fixture");
assert.equal(sha256(replayBytes), identity.replaySha256);
assert.equal(decoderBytes.byteLength, 1024);
assert.equal(sha256(decoderBytes), decoderSha256);
assert.deepEqual(workerMotion.waypointOrigin, [7358, 7412]);

// Run the exact bundled module in a worker thread and bridge only its Web
// Worker message surface. Artifact transfer follows the browser's entrypoint.
const moduleUrl =
  "data:text/javascript;base64," + Buffer.from(workerBytes).toString("base64");
const bootstrap = `
  import { parentPort, workerData } from "node:worker_threads";
  globalThis.addEventListener = (event, handle) => {
    if (event !== "message") throw Error("Unexpected Worker event: " + event);
    parentPort.on(event, data => handle({ data }));
  };
  globalThis.postMessage = (value, transfers) => parentPort.postMessage(value, transfers);
  await import(workerData);
`;

async function decode(replay, decoder) {
  const worker = new Worker(
    new URL(
      "data:text/javascript;base64," +
        Buffer.from(bootstrap).toString("base64"),
    ),
    { workerData: moduleUrl },
  );
  let timeout;
  try {
    return await new Promise((resolve, reject) => {
      timeout = setTimeout(
        () => reject(Error("Replay worker timed out")),
        30000,
      );
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (code) =>
        reject(Error(`Replay worker exited before responding (${code})`)),
      );
      worker.postMessage(
        {
          identity,
          waypointOrigin: workerMotion.waypointOrigin,
          replayBytes: replay,
          decoderBytes: decoder,
        },
        [replay, decoder],
      );
    });
  } finally {
    clearTimeout(timeout);
    await worker.terminate();
  }
}

function flipLastByte(bytes) {
  const copy = bytes.slice(0);
  const view = new Uint8Array(copy);
  view[view.length - 1] ^= 1;
  return copy;
}

const ready = await decode(replayBytes.slice(0), decoderBytes.slice(0));
assert.equal(ready.type, "ready", ready.message);
assert.equal(ready.motion.tracks.length, 10);
assert.equal(ready.frames.length, fixture.keyframes);
assert.equal(
  ready.frames.reduce((count, frame) => count + frame.markers.length, 0),
  fixture.markers,
);
assert.deepEqual(ready.coverage, baseline.motionCoverage);

const frameProjection = (frames, projectMarker) =>
  frames.map(({ timeSeconds, markers }) => ({
    timeSeconds,
    markers: markers
      .map(projectMarker)
      .sort((left, right) => left[0] - right[0]),
  }));
assert.deepEqual(
  frameProjection(ready.frames, ({ participantId, x, z }) => [
    participantId,
    x,
    z,
  ]),
  frameProjection(
    baseline.decodedPositionFrames,
    ({ participantId, position: [x, , z] }) => [participantId, x, z],
  ),
);

const { sampleTimes } = fixture;
function sample(motion, time) {
  const { markers, coverage } = sampleNativeTerrainMotion(motion, time);
  return {
    coverage,
    markers: markers.map(({ x, z, ...marker }) => ({
      ...marker,
      direction:
        marker.direction?.map((component) => Math.round(component * 1e8)) ??
        null,
      x: Math.round(x * 1e6),
      z: Math.round(z * 1e6),
    })),
  };
}
for (const time of sampleTimes) {
  assert.deepEqual(
    sample(ready.motion, time),
    sample(baseline.motion, time),
    `Motion differs at ${time}s`,
  );
}

const rejectedReplay = await decode(
  flipLastByte(replayBytes),
  decoderBytes.slice(0),
);
const rejectedDecoder = await decode(
  replayBytes.slice(0),
  flipLastByte(decoderBytes),
);
assert.equal(rejectedReplay.type, "error");
assert.match(rejectedReplay.message, /replay.*(?:SHA-256|digest)/i);
assert.equal(rejectedDecoder.type, "error");
assert.match(rejectedDecoder.message, /decoder.*digest/i);

console.log(
  JSON.stringify(
    {
      fixtureSha256: identity.replaySha256,
      decoderSha256,
      workerBundleSha256: sha256(workerBytes),
      tracks: ready.motion.tracks.length,
      keyframes: ready.frames.length,
      positions: ready.coverage.keyframes.admittedMarkers,
      comparedSampleTimes: sampleTimes,
      tamperedReplayRejected: true,
      tamperedDecoderRejected: true,
    },
    null,
    2,
  ),
);
