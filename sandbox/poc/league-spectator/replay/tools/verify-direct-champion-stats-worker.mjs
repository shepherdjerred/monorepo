import assert from "node:assert/strict";
import path from "node:path";
import { openReplay } from "../transport.mjs";

const args = Bun.argv.slice(2);
assert.equal(
  args.length,
  6,
  "Supply a private manifest, its SHA-256, current Map11 ROFL, current Map12 ROFL, older Map11 ROFL, and native oracle directory.",
);
const [manifestArg, manifestSha256, ...paths] = args;
assert.match(
  manifestSha256,
  /^[a-f0-9]{64}$/u,
  "Invalid manifest SHA-256 pin.",
);
const manifestPath = path.resolve(manifestArg);
const [currentReplay, map12Replay, olderReplay, oracleRoot] = paths.map(
  (value) => path.resolve(value),
);
const sha256 = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const root = path.dirname(manifestPath);
const manifestBytes = await Bun.file(manifestPath).bytes();
assert.equal(
  sha256(manifestBytes),
  manifestSha256,
  "Private package manifest digest differs.",
);
const manifest = JSON.parse(
  new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
);

async function packageAsset(name) {
  const entry = manifest.files.find((file) => file.path === name);
  assert.ok(entry);
  const bytes = await Bun.file(path.join(root, name)).arrayBuffer();
  assert.equal(bytes.byteLength, entry.bytes);
  assert.equal(
    sha256(bytes),
    entry.sha256,
    "Private package asset digest differs.",
  );
  return bytes;
}

const scene = JSON.parse(
  new TextDecoder().decode(await packageAsset("scene.json")),
);
assert.equal(scene.workerMotion.decodeChampionStats, true);
assert.equal(scene.workerMotion.allowCurrentBuild, true);
assert.ok(!Object.hasOwn(scene, "championHealthTracks"));
assert.ok(!Object.hasOwn(scene, "championResourceTracks"));
const workerPath = "replay-motion-worker.mjs";
await packageAsset(workerPath);

async function runWorker(replayPath) {
  const replayBytes = await Bun.file(replayPath).arrayBuffer();
  const replay = openReplay(replayBytes);
  const identity = {
    replaySha256: sha256(replayBytes),
    build: replay.build,
    protocol: replay.protocol,
    durationMilliseconds: replay.durationMilliseconds,
    participantCount: replay.roster.length,
  };
  const decoderBytes = await packageAsset("replay-motion-decoder.bin");
  const worker = new Worker(path.join(root, workerPath));
  let timeout;
  try {
    const reply = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data);
      worker.onerror = () => reject(new Error("Isolated stats worker failed."));
      timeout = setTimeout(
        () => reject(new Error("Isolated stats worker timed out.")),
        60_000,
      );
      worker.postMessage(
        {
          identity,
          waypointOrigin: scene.workerMotion.waypointOrigin,
          allowCurrentBuild: true,
          decodeChampionStats: true,
          replayBytes,
          decoderBytes,
        },
        [replayBytes, decoderBytes],
      );
    });
    return { identity, reply };
  } finally {
    clearTimeout(timeout);
    worker.terminate();
  }
}

async function readOracle(name, digest) {
  const bytes = await Bun.file(path.join(oracleRoot, name)).bytes();
  assert.equal(sha256(bytes), digest, "Native stats oracle digest differs.");
  return JSON.parse(new TextDecoder().decode(bytes));
}

function tracksDigest(tracks) {
  return sha256(
    JSON.stringify(
      tracks.toSorted((a, b) => a.participantId - b.participantId),
    ),
  );
}

const [current, map12, older] = await Promise.all(
  [currentReplay, map12Replay, olderReplay].map(runWorker),
);
assert.equal(current.identity.replaySha256, manifest.capabilities.replaySha256);
assert.equal(current.identity.replaySha256, scene.identity.replaySha256);
assert.equal(current.identity.build, "16.23.841.8428");
assert.equal(current.reply.type, "ready", current.reply.message);
const [oracleHealth, oracleResources] = await Promise.all([
  readOracle(
    "scout-8428-champion-health.json",
    "f2b0232bc86868479da10e6ed38bdb233867605ffe64c2116db078878ad651bd",
  ),
  readOracle(
    "scout-8428-champion-resources.json",
    "4678aaf2167c5186e6bf64df83757831bdd5510b29ce8edc5308dc6ce57772e7",
  ),
  readOracle(
    "scout-8428-health-native.json",
    "3a84587c250585b04d5e16c6c3ad49c3bfed6d406161d118100f65703d711a38",
  ),
  readOracle(
    "scout-8428-resources-native.json",
    "824d568719f530e728eebb0d0abea47761516acef53d5f28a1c3653433258e9f",
  ),
]);
for (const oracle of [oracleHealth, oracleResources])
  assert.equal(oracle.replaySha256, current.identity.replaySha256);
const { championHealthTracks, championResourceTracks } =
  current.reply.championStats;
assert.equal(
  tracksDigest(championHealthTracks),
  tracksDigest(
    oracleHealth.tracks.map(({ participantId, points }) => ({
      participantId,
      points,
    })),
  ),
);
assert.equal(
  tracksDigest(championResourceTracks),
  tracksDigest(
    oracleResources.tracks.map(({ participantId, gold, resource }) => ({
      participantId,
      gold,
      resource,
    })),
  ),
);
assert.equal(map12.identity.build, current.identity.build);
assert.notEqual(map12.identity.replaySha256, current.identity.replaySha256);
assert.equal(
  map12.reply.type,
  "error",
  "Held-out same-build Map12 emitted worker results.",
);
assert.ok(!Object.hasOwn(map12.reply, "championStats"));
assert.equal(older.identity.build, "16.23.840.6595");
assert.equal(older.reply.type, "error", "Older Map11 emitted worker results.");
assert.match(
  older.reply.message,
  /champion stats require the reviewed current build/u,
);
assert.ok(!Object.hasOwn(older.reply, "championStats"));
process.stdout.write(
  `${JSON.stringify({
    actors: championHealthTracks.length,
    healthPoints: championHealthTracks.reduce(
      (total, track) => total + track.points.length,
      0,
    ),
    resourcePoints: championResourceTracks.reduce(
      (total, track) => total + track.resource.length,
      0,
    ),
    goldPoints: championResourceTracks.reduce(
      (total, track) => total + track.gold.length,
      0,
    ),
    map12Rejected: true,
    olderMap11Rejected: true,
  })}\n`,
);
