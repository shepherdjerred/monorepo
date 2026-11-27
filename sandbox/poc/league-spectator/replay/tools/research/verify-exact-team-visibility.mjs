import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { bindNativeTerrainChampionIdentities } from "./native-terrain-champion-identities.mjs";
import {
  createExactTerrainByteCodecs,
  prepareExactTerrainDecoder,
} from "./native-terrain-positions-944.mjs";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { current: { type: "boolean", default: false } },
});
const [
  replayPath,
  decoderPath,
  python,
  proofPath,
  tracksPath,
  scenePath,
  ...extra
] = positionals;
const current = values.current;
if (
  !replayPath ||
  !decoderPath ||
  !python ||
  !proofPath ||
  !tracksPath ||
  extra.length ||
  (current && !scenePath)
)
  throw Error(
    "Usage: bun verify-exact-team-visibility.mjs [--current] <saved-rofl> <exact-macos-binary> <python-with-unicorn> <proof-json> <tracks-json> [admitted-scene-json; required with --current]",
  );

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const replayBytes = await Bun.file(replayPath).arrayBuffer();
const replay = openReplay(replayBytes);
const replaySha256 = sha256(new Uint8Array(replayBytes));
assert.equal(
  replaySha256,
  current
    ? "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1"
    : "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
);
const image = await Bun.file(decoderPath).bytes();
const binarySha256 = sha256(image);
const options = { allowCurrentBuild: current };
const decoder = prepareExactTerrainDecoder(image, replay, options);
const codecs = createExactTerrainByteCodecs(decoder, replay, options);
const inflate = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const prepared = prepareReplayForSeek(replayBytes, inflate, options);
const { binding } = bindNativeTerrainChampionIdentities(
  prepared,
  codecs,
  options,
);
const actors = new Map(
  binding.verified.map(({ context, footerRow }) => {
    const { champion, team } = prepared.observations.roster[footerRow - 1];
    return [context, { champion, team, family: "champions" }];
  }),
);
assert.equal(actors.size, 10);
let sceneSha256 = null;
if (scenePath) {
  const sceneBytes = await Bun.file(scenePath).bytes();
  sceneSha256 = sha256(sceneBytes);
  if (current)
    assert.equal(
      sceneSha256,
      "f9da8ecd935ffe403d39e4c2ef649c6aa86875846a91a45989c0a4096211bd4c",
      "Current team visibility requires the reviewed v6 scene and roster",
    );
  const scene = JSON.parse(new TextDecoder().decode(sceneBytes));
  assert.equal(scene.identity.replaySha256, replaySha256);
  assert.equal(scene.identity.build, replay.build);
  assert.equal(scene.identity.protocol, replay.protocol);
  for (const [family, group] of Object.entries({
    worldUnits: scene.worldUnitModels,
    turrets: scene.structureModels,
    inhibitors: scene.inhibitorModels,
    nexus: scene.nexusModels,
  })) {
    for (const { context, creationTimeSeconds } of group?.instances ?? []) {
      assert.ok(
        Number.isInteger(context) && context > 0 && !actors.has(context),
      );
      actors.set(context, { family, creationTimeSeconds });
    }
  }
}
const cohorts = new Map();
const actorRows = [];
const snapshotRows = new Map();
const packetCounts = Object.fromEntries(
  [...new Set([...actors.values()].map(({ family }) => family))].map(
    (family) => [
      family,
      {
        contexts: 0,
        gameplaySetContexts: 0,
        gameplayClearContexts: 0,
        initializedTracks: 0,
        changes: 0,
      },
    ],
  ),
);
const setContexts = new Set();
const clearContexts = new Set();
let opcode = null;
let context = 0;
let sequence = 0;
let openingChunk = null;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, inflate),
)) {
  sequence++;
  const { blockOffset, chunkId, chunkOffset, payload, stream, timeSeconds } =
    packet;
  if (blockOffset === 0) {
    opcode = null;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (stream === 2 && openingChunk === null) openingChunk = chunkOffset;
  if (![43, 66, 696, 1012].includes(opcode)) continue;
  const maskPacket = opcode === 66 || opcode === 696;
  const bodyHex = maskPacket ? Buffer.from(payload).toString("hex") : null;
  if (maskPacket) assert.ok(payload.length === 2);
  const key = `${stream}:${opcode}:${bodyHex ?? ""}`;
  cohorts.set(key, (cohorts.get(key) ?? 0) + 1);
  const actor = actors.get(context);
  if (actor) {
    if (stream === 1 && opcode === 66) setContexts.add(context);
    if (stream === 1 && opcode === 696) clearContexts.add(context);
    const openingSnapshot = stream === 2 && chunkOffset === openingChunk;
    if (stream !== 1 && !openingSnapshot && actor.family !== "champions")
      continue;
    if (
      actor.creationTimeSeconds !== undefined &&
      timeSeconds < actor.creationTimeSeconds
    )
      continue;
    const row = {
      champion: actor.champion,
      context,
      opcode,
      bodyHex,
      stream,
      sequence,
      timeSeconds,
      chunkId,
      blockOffset,
      bodySha256: actor.family === "champions" ? sha256(payload) : null,
    };
    if (stream === 1 || openingSnapshot) actorRows.push(row);
    if (stream === 2 && actor.family === "champions") {
      if (!snapshotRows.has(chunkId)) snapshotRows.set(chunkId, new Map());
      const snapshot = snapshotRows.get(chunkId);
      if (!snapshot.has(context)) snapshot.set(context, []);
      snapshot.get(context).push(row);
    }
  }
}
const bodies = [
  ...new Set(
    [...cohorts.keys()].map((key) => key.split(":")[2]).filter(Boolean),
  ),
];
const oracle = Bun.spawnSync(
  [
    python,
    fileURLToPath(
      new URL("./exact-team-visibility-oracle.py", import.meta.url),
    ),
    decoderPath,
    ...(current ? ["--current"] : []),
  ],
  {
    stdin: new TextEncoder().encode(JSON.stringify(bodies)),
    stderr: "inherit",
  },
);
assert.equal(oracle.exitCode, 0);
const oracleText = new TextDecoder("utf-8", { fatal: true })
  .decode(oracle.stdout)
  .trim();
const native = JSON.parse(oracleText);
assert.deepEqual(Object.keys(native.bodies).sort(), bodies.toSorted());
assert.deepEqual(native.slots, { 100: 1, 200: 2 });
const teamForSlot = new Map(
  Object.entries(native.slots).map(([team, slot]) => [slot, Number(team)]),
);
const states = new Map();
const totals = {};
const examples = {};
const retain = (changes, time, mask) => {
  if (changes.at(-1)?.[0] === time) changes.pop();
  if (changes.at(-1)?.[1] !== mask) changes.push([time, mask]);
};
for (const row of actorRows) {
  const { context, opcode, stream, bodyHex } = row;
  if (!states.has(context))
    states.set(context, { mask: 0, initialization: null, changes: [] });
  const state = states.get(context);
  if (opcode === 1012) {
    if (!state.initialization) {
      state.initialization = row;
      retain(state.changes, row.timeSeconds, state.mask);
    }
    continue;
  }
  // This exact reset only clears the initialized flag in mode 0. Keep the
  // mode-3 mask history, using the opening snapshot and gameplay stream.
  if (opcode === 43) continue;
  const slot = native.bodies[bodyHex].slot;
  const team = teamForSlot.get(slot);
  assert.ok(team);
  const bit = 1 << slot;
  const before = state.mask;
  state.mask = opcode === 66 ? state.mask | bit : state.mask & ~bit;
  if (!state.initialization || before === state.mask) continue;
  retain(state.changes, row.timeSeconds, state.mask);
  if (stream !== 1 || row.timeSeconds === 0 || !row.champion) continue;
  const direction = opcode === 66 ? "gained" : "lost";
  const key = `${team}:${direction}`;
  totals[key] = (totals[key] ?? 0) + 1;
  examples[key] ??= {
    team,
    direction,
    before,
    after: state.mask,
    initializeRequest: state.initialization,
    request: row,
  };
}
for (const team of teamForSlot.values())
  for (const direction of ["gained", "lost"])
    assert.ok(
      examples[`${team}:${direction}`],
      `Missing archived ${team} ${direction} transition`,
    );

const tracks = [...actors].flatMap(([context, actor]) => {
  const state = states.get(context);
  const coverage = packetCounts[actor.family];
  coverage.contexts++;
  if (setContexts.has(context)) coverage.gameplaySetContexts++;
  if (clearContexts.has(context)) coverage.gameplayClearContexts++;
  if (actor.family === "champions") {
    assert.ok(state?.initialization);
    const ownTeamBit = 1 << native.slots[actor.team];
    assert.equal(state.changes[0][0], 0);
    assert.ok(state.changes.every(([, mask]) => (mask & ownTeamBit) !== 0));
  }
  if (!state?.initialization) return [];
  coverage.initializedTracks++;
  coverage.changes += state.changes.length;
  return [{ context, changes: state.changes }];
});
const snapshotAudit = [];
for (const [chunkId, snapshot] of snapshotRows) {
  for (const { context, changes } of tracks.filter(
    ({ context }) => actors.get(context).family === "champions",
  )) {
    const rows = snapshot.get(context) ?? [];
    const initialize = rows.find(({ opcode }) => opcode === 1012);
    if (!initialize) {
      snapshotAudit.push({
        chunkId,
        context,
        status: "missing-initialization",
      });
      continue;
    }
    let mask = 0;
    for (const row of rows) {
      assert.equal(row.timeSeconds, initialize.timeSeconds);
      if (row.opcode === 66) mask |= 1 << native.bodies[row.bodyHex].slot;
      if (row.opcode === 696) mask &= ~(1 << native.bodies[row.bodyHex].slot);
    }
    const continuous = changes.findLast(
      ([time]) => time <= initialize.timeSeconds,
    )?.[1];
    snapshotAudit.push({
      chunkId,
      context,
      timeSeconds: initialize.timeSeconds,
      snapshotMask: mask,
      continuousMask: continuous,
      status: mask === continuous ? "agrees" : "differs",
    });
  }
}
const artifact = JSON.stringify({
  schema: 1,
  kind: "exact-scout-team-vision",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  tracks,
});
const tracksSha256 = sha256(artifact);
if (current)
  assert.equal(
    tracksSha256,
    "c2cf2a71c991078e164027ec43fc2ee8fa868237e71bca251e7fee0e13264e43",
    "Current team visibility differs from the reviewed tracks",
  );
await Bun.write(tracksPath, artifact);
await Bun.write(
  proofPath,
  JSON.stringify(
    {
      schema: 1,
      build: replay.build,
      protocol: replay.protocol,
      replaySha256,
      binarySha256,
      ...(current ? { nativeOracleSha256: sha256(oracleText) } : {}),
      scope: current
        ? "Continuous team-mask replay after the first observed initialize request, plus the exact current native packet reader, set/clear operations and selected-view query with supplied inputs. Five champion snapshot comparisons differ. Snapshot registration, live callback acceptance, terrain fog and obscured champion presentation remain unresolved."
        : "Original packet readers, component mask operations and selected-view query with supplied inputs. Archived champion mask transitions after an initialize request. Full snapshot registration, live callback acceptance and terrain fog remain unverified.",
      transportPackets: sequence,
      cohorts: Object.fromEntries(cohorts),
      native,
      totals,
      examples,
      snapshotAudit,
      tracksSha256,
      sceneSha256,
      packetCounts,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    { proofPath, tracksPath, tracksSha256, totals, packetCounts },
    null,
    2,
  ),
);
