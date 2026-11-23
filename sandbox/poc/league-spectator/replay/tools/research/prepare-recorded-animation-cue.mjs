import assert from "node:assert/strict";
import {
  mkdir,
  realpath,
  readFile,
  writeFile,
  copyFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { replayTimedPacketEnvelopes } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-packet-clock.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { auditChampionAnimation } from "../verify-native-terrain-champion-animation.mjs";
import { openLocalWad } from "../wad.mjs";
import { assertExactTerrainReplay } from "./native-terrain-byte-codecs.mjs";

const reviewed = new Map([
  [
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
    {
      champion: "MonkeyKing",
      skinId: 5,
      participantId: 7,
      context: 1073742167,
      name: "Spell1",
      chunkId: 4,
      blockOffset: 82718,
      payload: "beffeb8a3ebdbde087d8",
      timeSeconds: 47.51853248596191,
      flags: 16,
    },
  ],
  [
    "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
    {
      champion: "Jinx",
      skinId: 60,
      participantId: 9,
      context: 1073742169,
      name: "Exalted_Spawn",
      chunkId: 3,
      blockOffset: 68277,
      payload: "bebfeb717b984a87d8b3cbe077bd4aebe4",
      timeSeconds: 1.509,
      flags: 0,
    },
  ],
]);
const [
  installation,
  replayFile,
  executable,
  championsFile,
  modelsFile,
  output,
  ...extra
] = process.argv.slice(2);
if (!output || extra.length)
  throw Error(
    "Usage: bun prepare-recorded-animation-cue.mjs <exact Windows installation> <original ROFL> <archived universal macOS executable> <champion source manifest> <ordinal model manifest> <new private .cache subdirectory>",
  );

const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const digest = async (path) => sha(await readFile(path));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const cache = await realpath(".cache");
const parent = await realpath(dirname(resolve(output)));
if (parent !== cache && !parent.startsWith(cache + sep))
  throw Error("Cue output must stay in private .cache");
const destination = join(parent, basename(output));
const out = (name) => join(destination, name);
const emit = (name, value) =>
  writeFile(out(name), JSON.stringify(value, null, 2), { flag: "wx" });
const replayBytes = Uint8Array.from(await readFile(replayFile));
const replaySha256 = sha(replayBytes);
const review = reviewed.get(replaySha256);
if (!review) throw Error("Expected a reviewed exact-build replay");
const replay = openReplay(replayBytes.buffer);
assertExactTerrainReplay(replay);

let context = 0;
let opcode;
let cue;
let nextSameActorRequestSeconds;
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, (bytes, target) =>
    zstdDecompressSync(bytes, { maxOutputLength: target.byteLength }),
  ),
)) {
  if (packet.blockOffset === 0) {
    context = 0;
    opcode = undefined;
  }
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  opcode = packet.explicitOpcode ?? opcode;
  if (packet.stream !== 1 || opcode !== 669 || context !== review.context)
    continue;
  if (cue) {
    nextSameActorRequestSeconds = packet.timeSeconds;
    break;
  }
  if (
    packet.chunkId !== review.chunkId ||
    packet.blockOffset !== review.blockOffset
  )
    continue;
  const payload = Buffer.from(packet.payload).toString("hex");
  assert.equal(payload, review.payload);
  assert.equal(packet.timeSeconds, review.timeSeconds);
  cue = {
    context,
    stream: packet.stream,
    chunkId: packet.chunkId,
    blockOffset: packet.blockOffset,
    timeSeconds: packet.timeSeconds,
    payload,
  };
}
assert.ok(
  cue && nextSameActorRequestSeconds > cue.timeSeconds,
  "Missing reviewed request or successor",
);

const audit = await auditChampionAnimation(
  installation,
  championsFile,
  replayBytes,
  [review.name],
  { includeEvents: true },
);
assertExactTerrainReplay(audit);
const { actors: sourceActors } = await json(championsFile);
const actor = sourceActors.find((row) => row.context === review.context);
const source = audit.actors.find((row) => row.context === review.context);
for (const selected of [source, actor]) {
  assert.equal(selected.champion, review.champion);
  assert.equal(selected.skinId, review.skinId);
  assert.equal(selected.footerRow, review.participantId);
}
assert.equal(source.creationSha256, actor.creationSha256);
const authored = source.probes[review.name];
assert.equal(authored?.classHash, mapBinHash("AtomicClipData"));
assert.equal(authored.magic, "r3d2canm");
assert.equal(authored.version, 1);
assert.equal(authored.resource.type, "WadChunkLink");
const wad = await openLocalWad(
  installation,
  actor.archive,
  Bun.zstdDecompressSync,
);
const animation = await wad.byHash(BigInt(authored.resource.value));
assert.equal(sha(animation), authored.sha256);

const models = await json(modelsFile);
assertExactTerrainReplay(models);
assert.equal(models.replaySha256, replaySha256);
const model = models.actors.find((row) => row.context === review.context);
const ordinalRoot = `${review.champion.toLowerCase()}-${review.skinId}`;
assert.equal(model.skinId, review.skinId);
assert.equal(model.footerRow, review.participantId);
assert.equal(model.champion, review.champion);
assert.equal(actor.resources.skeleton.file, `${ordinalRoot}/model.skl`);
assert.equal(actor.resources.skeleton.sha256, model.inputs.skeleton.sha256);
assert.equal(model.model.file, `${ordinalRoot}/model.glb`);
assert.equal(model.jointBindings.file, `${ordinalRoot}/joint-bindings.json`);
const rigFile = join(dirname(championsFile), actor.resources.skeleton.file);
const bindingsFile = join(dirname(modelsFile), model.jointBindings.file);
assert.equal(await digest(rigFile), actor.resources.skeleton.sha256);
assert.equal(await digest(bindingsFile), model.jointBindings.sha256);
assert.equal(
  await digest(join(dirname(modelsFile), model.model.file)),
  model.model.sha256,
);

const tool = (name) => fileURLToPath(new URL(name, import.meta.url));
function runPython(script, ...args) {
  const result = Bun.spawnSync(
    [
      "uv",
      "run",
      "--with",
      "unicorn",
      "--with",
      "capstone",
      tool(script),
      ...args,
    ],
    {
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if (!result.success) throw Error(`Cue oracle failed: ${script}`);
}
const graphKey = mapBinHash(review.name);
await mkdir(destination);
await writeFile(out("authored.anm"), animation, { flag: "wx" });
await copyFile(rigFile, out("model.skl"));
await copyFile(bindingsFile, out("joint-bindings.json"));
await emit("source.json", {
  actor,
  cue,
  clip: review.name,
  authored: { sha256: authored.sha256, graphKey },
  replaySha256,
});
runPython("recorded-animation-packet-oracle.py", executable, destination);
const packet = await json(out("packet-reader.json"));
assert.equal(packet.context, review.context);
assert.equal(packet.name, review.name);
assert.equal(packet.payload, review.payload);
assert.equal(packet.callback.nameHash, graphKey);
assert.equal(packet.callback.flags, review.flags);
assert.equal(packet.callback.requestFloatBits, "3f800000");
assert.equal(packet.callback.adjustmentFloatBits, "00000000");
assert.equal(packet.callback.overrideFloatBits, "00000000");
runPython(
  "../probe-exact-compressed-animation.py",
  "--client",
  executable,
  "--animation",
  out("authored.anm"),
  "--rig",
  out("model.skl"),
  "--receipt",
  out("native.json"),
  "--clip",
  out("authored.clip"),
  "--animation-sha256",
  authored.sha256,
  "--rig-sha256",
  actor.resources.skeleton.sha256,
);
const native = await json(out("native.json"));
assert.equal(native.boundary, null);
assert.equal(native.sourceRigSha256, actor.resources.skeleton.sha256);
assert.equal(native.sourceAnmSha256, authored.sha256);
assert.equal(await digest(out("authored.clip")), native.nativeClip.sha256);
const { timeSeconds } = cue;
const { requestFloat: rate } = packet.callback;
const durationSeconds = native.nativeClip.duration;
assert.ok(Number.isFinite(durationSeconds) && durationSeconds > 0);
await emit("scout-animation.json", {
  schema: 1,
  kind: "recorded-champion-animation-cues",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  scope:
    "Isolated authored pose reconstruction at a recorded animation request and its natural clip window. The prior blended pose, runtime activation gate, and other actor preemption remain unverified.",
  cues: [
    {
      participantId: review.participantId,
      context,
      champion: review.champion,
      skinId: review.skinId,
      timeSeconds,
      endSeconds: Math.min(
        timeSeconds + durationSeconds / rate,
        nextSameActorRequestSeconds,
      ),
      durationSeconds,
      rate,
      modelSha256: model.model.sha256,
      rig: { file: "model.skl", sha256: native.sourceRigSha256 },
      clip: { file: "authored.clip", sha256: native.nativeClip.sha256 },
      bindings: {
        file: "joint-bindings.json",
        sha256: model.jointBindings.sha256,
      },
      request: {
        opcode: 669,
        context,
        name: review.name,
        graphKey,
        animationSha256: authored.sha256,
        graphSha256: source.animationGraph.sha256,
        flags: packet.callback.flags,
        rateBits: packet.callback.requestFloatBits,
        adjustmentBits: packet.callback.adjustmentFloatBits,
        overrideBits: packet.callback.overrideFloatBits,
        stream: cue.stream,
        chunkId: cue.chunkId,
        blockOffset: cue.blockOffset,
        payloadHex: cue.payload,
        payloadSha256: sha(Buffer.from(cue.payload, "hex")),
        nextSameActorRequestSeconds,
      },
    },
  ],
});
console.log(out("scout-animation.json"));
