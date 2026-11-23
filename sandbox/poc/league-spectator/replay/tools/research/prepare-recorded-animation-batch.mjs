import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { openReplay } from "../../transport.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { auditChampionAnimation } from "../verify-native-terrain-champion-animation.mjs";
import { openLocalWad } from "../wad.mjs";
import { assertExactTerrainReplay } from "./native-terrain-byte-codecs.mjs";
import {
  recordedAnimationRequests,
  supportsRecordedAnimationRequest,
} from "./recorded-animation-requests.mjs";

const [
  installation,
  replayFile,
  executable,
  championsFile,
  modelsFile,
  exporter,
  output,
  ...extra
] = process.argv.slice(2);
if (!output || extra.length)
  throw Error(
    "Usage: bun prepare-recorded-animation-batch.mjs <exact Windows installation> <original ROFL> <archived macOS executable> <champion source manifest> <ordinal model manifest> <AnimationPack.dll> <new private .cache subdirectory>",
  );

const sha = (bytes) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
const digest = async (path) => sha(await readFile(path));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const cache = await realpath(".cache");
const parent = await realpath(dirname(resolve(output)));
assert.ok(
  parent === cache || parent.startsWith(cache + sep),
  "Output must stay in private .cache",
);
const destination = join(parent, basename(output));
const out = (name) => join(destination, name);
const emit = (name, value) =>
  writeFile(out(name), JSON.stringify(value, null, 2), { flag: "wx" });

const replayBytes = Uint8Array.from(await readFile(replayFile));
const replaySha256 = sha(replayBytes);
assert.equal(
  replaySha256,
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
);
const replay = openReplay(replayBytes.buffer);
assertExactTerrainReplay(replay);
const sources = await json(championsFile);
const models = await json(modelsFile);
for (const manifest of [sources, models]) {
  assertExactTerrainReplay(manifest);
  assert.equal(manifest.replaySha256, replaySha256);
}
assert.equal(models.sourceManifestSha256, await digest(championsFile));
const exporterPath = await realpath(exporter);
const exporterSha256 = await digest(exporterPath);
const toolkitSha256 = await digest(
  join(dirname(exporterPath), "LeagueToolkit.dll"),
);
assert.equal(toolkitSha256, models.toolchain.assemblies["LeagueToolkit.dll"]);
const actors = new Map(sources.actors.map((actor) => [actor.context, actor]));
const decompress = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const packets = [];
const payloads = new Map();
const lastByActor = new Map();
for (const packet of recordedAnimationRequests(replay, decompress, actors)) {
  const { context, stream, chunkId, blockOffset, timeSeconds } = packet;
  const payload = Buffer.from(packet.payload).toString("hex");
  const request = {
    context,
    stream,
    chunkId,
    blockOffset,
    timeSeconds,
    payload,
    next: null,
  };
  const previous = lastByActor.get(context);
  if (previous) {
    assert.ok(
      timeSeconds >= previous.timeSeconds,
      "Nonmonotonic actor request clock",
    );
    previous.next = timeSeconds;
  }
  lastByActor.set(context, request);
  packets.push(request);
  const key = context + ":" + payload;
  if (!payloads.has(key)) payloads.set(key, { context, payload });
}
assert.ok(packets.length > 0);

function runPython(script, ...args) {
  return Bun.spawnSync(
    [
      "uv",
      "run",
      "--offline",
      "--with",
      "unicorn",
      "--with",
      "capstone",
      fileURLToPath(new URL(script, import.meta.url)),
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
}

await mkdir(destination);
await emit("packet-requests.json", [...payloads.values()]);
const oracle = runPython(
  "recorded-animation-packet-oracle.py",
  executable,
  destination,
);
assert.ok(oracle.success, oracle.stderr.toString());
const decoded = await json(out("packet-reader.json"));
assert.equal(decoded.length, payloads.size);
const witnesses = new Map();
const names = new Set();
for (const result of decoded) {
  const key = result.context + ":" + result.payload;
  assert.ok(
    payloads.has(key) && !witnesses.has(key),
    "Invalid packet oracle witness",
  );
  witnesses.set(key, result);
  if (
    result.callback &&
    supportsRecordedAnimationRequest(
      result.callback.flags,
      result.callback.adjustmentFloatBits,
      result.callback.overrideFloatBits,
    )
  ) {
    assert.match(result.name, /^[A-Za-z0-9_]+$/u);
    assert.equal(result.callback.nameHash, mapBinHash(result.name));
    names.add(result.name);
  }
}

const audit = await auditChampionAnimation(
  installation,
  championsFile,
  replayBytes,
  names,
  {
    includeEvents: true,
  },
);
assertExactTerrainReplay(audit);
const actorAssets = new Map();
const clips = new Map();

async function readActorAssets(actor) {
  const { context, champion, skinId, footerRow, archive, resources } = actor;
  const source = audit.actors.find((row) => row.context === context);
  const model = models.actors.find((row) => row.context === context);
  for (const row of [source, model]) {
    assert.equal(row.champion, champion);
    assert.equal(row.skinId, skinId);
    assert.equal(row.footerRow, footerRow);
  }
  assert.equal(source.creationSha256, actor.creationSha256);
  const ordinalRoot = `${champion.toLowerCase()}-${skinId}`;
  const rigRow = resources.skeleton;
  assert.equal(rigRow.sha256, model.inputs.skeleton.sha256);
  assert.equal(rigRow.file, `${ordinalRoot}/model.skl`);
  assert.equal(model.model.file, `${ordinalRoot}/model.glb`);
  assert.equal(model.jointBindings.file, `${ordinalRoot}/joint-bindings.json`);
  assert.equal(
    await digest(join(dirname(modelsFile), model.model.file)),
    model.model.sha256,
  );
  const rig = { file: `${ordinalRoot}.skl`, sha256: rigRow.sha256 };
  const bindings = {
    file: `${ordinalRoot}.json`,
    sha256: model.jointBindings.sha256,
  };
  for (const [asset, manifest, file] of [
    [rig, championsFile, rigRow.file],
    [bindings, modelsFile, model.jointBindings.file],
  ]) {
    await copyFile(join(dirname(manifest), file), out(asset.file));
    assert.equal(await digest(out(asset.file)), asset.sha256);
  }
  const wad = await openLocalWad(installation, archive, Bun.zstdDecompressSync);
  const ordinalFolder = out(ordinalRoot);
  await mkdir(ordinalFolder);
  await copyFile(out(rig.file), join(ordinalFolder, "model.skl"));
  return { rig, bindings, source, model, wad, ordinalFolder };
}

async function bakeUncompressed(authored, rig, ordinalFolder, animation, key) {
  const source = join(ordinalFolder, `${key}.anm`);
  await writeFile(source, animation, { flag: "wx" });
  await writeFile(
    join(ordinalFolder, "selected-clips.json"),
    JSON.stringify({ authored: basename(source) }),
  );
  const target = join(ordinalFolder, key);
  const receipt = out(`${key}.toolkit.json`);
  const pack = Bun.spawnSync(
    ["dotnet", exporterPath, ordinalFolder, target, receipt],
    {
      cwd: destination,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  assert.ok(pack.success, pack.stderr.toString());
  const proof = await json(receipt);
  assert.equal(proof.rigSha256, rig.sha256);
  assert.equal(proof.records.length, 1);
  const record = proof.records[0];
  assert.equal(record.sourceSha256, authored.sha256);
  assert.equal(record.status, "prepared");
  assert.equal(record.evaluator, "pinned-toolkit-uncompressed");
  assert.ok(Number.isFinite(record.duration) && record.duration > 0);
  const file = `${key}.clip`;
  await copyFile(join(target, "0.clip"), out(file));
  return {
    durationSeconds: record.duration,
    clip: { file, sha256: await digest(out(file)) },
    evaluator: record.evaluator,
  };
}

async function bakeClip(authored, { rig, wad, ordinalFolder }) {
  const key = sha(Buffer.from(authored.sha256 + rig.sha256, "hex"));
  if (clips.has(key)) return clips.get(key);
  const { resource } = authored;
  const animation =
    resource.type === "WadChunkLink"
      ? await wad.byHash(BigInt(resource.value))
      : await wad(resource.value);
  assert.equal(sha(animation), authored.sha256);
  if (authored.magic === "r3d2anmd") {
    const packed = await bakeUncompressed(
      authored,
      rig,
      ordinalFolder,
      animation,
      key,
    );
    clips.set(key, packed);
    return packed;
  }
  const animationPath = `${authored.sha256}.anm`;
  const receiptPath = `${key}.native.json`;
  const clipPath = `${key}.clip`;
  if (!(await Bun.file(out(animationPath)).exists()))
    await writeFile(out(animationPath), animation, { flag: "wx" });
  const bake = runPython(
    "../probe-exact-compressed-animation.py",
    "--client",
    executable,
    "--animation",
    out(animationPath),
    "--rig",
    out(rig.file),
    "--receipt",
    out(receiptPath),
    "--clip",
    out(clipPath),
    "--animation-sha256",
    authored.sha256,
    "--rig-sha256",
    rig.sha256,
  );
  assert.ok(await Bun.file(out(receiptPath)).exists(), bake.stderr.toString());
  const native = await json(out(receiptPath));
  assert.equal(native.sourceRigSha256, rig.sha256);
  assert.equal(native.sourceAnmSha256, authored.sha256);
  if (!bake.success) {
    assert.ok(native.boundary?.phase, bake.stderr.toString());
    const failure = { reason: "native-pose-boundary", detail: native.boundary };
    clips.set(key, failure);
    return failure;
  }
  assert.equal(native.boundary, null);
  assert.equal(await digest(out(clipPath)), native.nativeClip.sha256);
  assert.ok(
    Number.isFinite(native.nativeClip.duration) &&
      native.nativeClip.duration > 0,
  );
  const result = {
    durationSeconds: native.nativeClip.duration,
    clip: { file: clipPath, sha256: native.nativeClip.sha256 },
    evaluator: "original-native-compressed-v1",
  };
  clips.set(key, result);
  console.log("Baked", clips.size, clipPath);
  return result;
}

const cues = [];
const omissions = [];
for (const row of packets) {
  const { context, stream, chunkId, blockOffset, timeSeconds, payload, next } =
    row;
  const actor = actors.get(context);
  const result = witnesses.get(context + ":" + payload);
  const { callback, name } = result;
  const omit = (reason, detail) =>
    omissions.push({
      context,
      champion: actor.champion,
      chunkId,
      blockOffset,
      timeSeconds,
      name,
      reason,
      detail,
    });
  if (!callback) {
    omit("native-request-boundary", result.omission);
    continue;
  }
  const {
    requestFloat: rate,
    flags,
    adjustmentFloatBits,
    overrideFloatBits,
  } = callback;
  if (
    !supportsRecordedAnimationRequest(
      flags,
      adjustmentFloatBits,
      overrideFloatBits,
    ) ||
    !(rate > 0)
  ) {
    omit("unsupported-request-fields", {
      flags,
      rate,
      adjustmentFloatBits,
      overrideFloatBits,
    });
    continue;
  }
  const limit = Math.min(next ?? Infinity, replay.duration);
  if (!(timeSeconds >= 0 && limit > timeSeconds)) {
    omit("empty-request-window");
    continue;
  }
  if (!actorAssets.has(context))
    actorAssets.set(context, await readActorAssets(actor));
  const assets = actorAssets.get(context);
  const { source, model, rig, bindings } = assets;
  const authored = source.probes[name];
  if (authored?.classHash !== mapBinHash("AtomicClipData")) {
    omit(
      authored ? "non-atomic-authored-clip" : "unknown-authored-clip",
      authored?.classHash,
    );
    continue;
  }
  if (!(
    (authored.magic === "r3d2canm" && authored.version === 1) ||
    (authored.magic === "r3d2anmd" && authored.version === 5)
  )) {
    omit("unsupported-authored-clip-format", {
      magic: authored.magic,
      version: authored.version,
    });
    continue;
  }
  const baked = await bakeClip(authored, assets);
  if (baked.reason) {
    omit(baked.reason, baked.detail);
    continue;
  }
  const { durationSeconds, clip, evaluator } = baked;
  const endSeconds = Math.min(timeSeconds + durationSeconds / rate, limit);
  cues.push({
    participantId: actor.footerRow,
    context,
    champion: actor.champion,
    skinId: actor.skinId,
    timeSeconds,
    endSeconds,
    durationSeconds,
    rate,
    modelSha256: model.model.sha256,
    rig,
    clip,
    bindings,
    evaluator,
    request: {
      opcode: 669,
      context,
      name,
      graphKey: callback.nameHash,
      animationSha256: authored.sha256,
      graphSha256: source.animationGraph.sha256,
      flags,
      rateBits: callback.requestFloatBits,
      adjustmentBits: adjustmentFloatBits,
      overrideBits: overrideFloatBits,
      stream,
      chunkId,
      blockOffset,
      payloadHex: payload,
      payloadSha256: sha(Buffer.from(payload, "hex")),
      nextSameActorRequestSeconds: next,
    },
  });
}
assert.equal(cues.length + omissions.length, packets.length);
assert.ok(cues.length > 0);
await emit("omissions.json", omissions);
await emit("scout-animation.json", {
  schema: 1,
  kind: "recorded-champion-animation-cues",
  build: replay.build,
  protocol: replay.protocol,
  replaySha256,
  exporter: { exporterSha256, toolkitSha256 },
  scope:
    "Isolated original authored poses at direct opcode 669 requests. Runtime activation, blending, and preemption by other opcode families remain unverified.",
  examinedRequests: packets.length,
  omittedRequests: {
    file: "omissions.json",
    sha256: await digest(out("omissions.json")),
    count: omissions.length,
  },
  cues,
});
console.log(
  JSON.stringify({
    receipt: out("scout-animation.json"),
    sha256: await digest(out("scout-animation.json")),
    cues: cues.length,
    omissions: omissions.length,
    clips: new Set(cues.map((cue) => cue.clip.sha256)).size,
  }),
);
