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
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { openReplay } from "../../transport.mjs";
import { prepareReplayForSeek } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/prepare.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { auditChampionAnimation } from "../verify-native-terrain-champion-animation.mjs";
import { openLocalWad } from "../wad.mjs";
import { readCurrentAnimationCueRequest } from "./native-terrain-animation-cue-reader.mjs";
import {
  assertExactTerrainReplay,
  recoverTerrainByteSubstitution,
} from "./native-terrain-byte-codecs.mjs";
import {
  openChampionModelCatalog,
  readChampionModelSelections,
  verifyNativeCatalogOpening,
} from "./native-terrain-champion-model-catalog.mjs";
import {
  createExactTerrainByteCodecs,
  prepareExactTerrainDecoder,
} from "./native-terrain-positions-944.mjs";
import {
  recordedAnimationRequests,
  supportsRecordedAnimationRequest,
} from "./recorded-animation-requests.mjs";
import { createCurrentChampionAnimationCatalog } from "./recorded-champion-animation-resources.mjs";

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
const { values: flags } = parseArgs({
  args: extra,
  options: {
    "current-build": { type: "boolean" },
    "equipped-roster": { type: "string" },
    "equipped-roster-sha256": { type: "string" },
  },
});
const current = flags["current-build"] === true;
const rosterPath = flags["equipped-roster"];
const rosterPin = flags["equipped-roster-sha256"];
if (
  !output ||
  (rosterPath === undefined) !== (rosterPin === undefined) ||
  (rosterPath !== undefined && (!current || !/^[a-f0-9]{64}$/u.test(rosterPin)))
)
  throw Error(
    "Usage: bun prepare-recorded-animation-batch.mjs <exact Windows installation> <original ROFL> <archived macOS executable> <champion source manifest> <ordinal model manifest> <AnimationPack.dll> <new private .cache subdirectory> [--current-build [--equipped-roster <receipt.json> --equipped-roster-sha256 <SHA-256>]]",
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
if (!current)
  assert.equal(
    replaySha256,
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
  );
const replay = openReplay(replayBytes.buffer);
const options = { allowCurrentBuild: current };
assertExactTerrainReplay(replay, options);
if (current) assert.equal(replay.build, "16.23.841.8428");
const sources = await json(championsFile);
const models = await json(modelsFile);
for (const manifest of [sources, models]) {
  assertExactTerrainReplay(manifest, options);
  assert.equal(manifest.build, replay.build);
  if (rosterPath === undefined)
    assert.equal(
      current ? manifest.nativeOpening?.replaySha256 : manifest.replaySha256,
      replaySha256,
    );
}
assert.equal(models.sourceManifestSha256, await digest(championsFile));
const exporterPath = await realpath(exporter);
const exporterSha256 = await digest(exporterPath);
const toolkitSha256 = await digest(
  join(dirname(exporterPath), "LeagueToolkit.dll"),
);
assert.equal(toolkitSha256, models.toolchain.assemblies["LeagueToolkit.dll"]);
const decompress = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
const skinKey = ({ champion, skinId }) => `${champion.toLowerCase()}-${skinId}`;
let selected = sources.actors;
let substitution;
let verifiedOpening;
if (current) {
  assert.deepEqual(sources.nativeOpening, models.nativeOpening);
  const prepared = prepareReplayForSeek(
    replayBytes.buffer,
    decompress,
    options,
  );
  const executableBytes = await readFile(executable);
  const codecs = createExactTerrainByteCodecs(executableBytes, replay, options);
  substitution = recoverTerrainByteSubstitution(codecs);
  const originalSelections = readChampionModelSelections(
    prepared,
    codecs,
    options,
  );
  if (rosterPath === undefined) {
    verifyNativeCatalogOpening(
      sources.nativeOpening,
      originalSelections,
      replaySha256,
    );
  } else {
    const bytes = await readFile(rosterPath);
    assert.equal(sha(bytes), rosterPin, "Equipped roster digest differs");
    const roster = JSON.parse(bytes);
    assert.deepEqual(
      [roster.build, roster.protocol, roster.replaySha256],
      [replay.build, replay.protocol, replaySha256],
    );
    assert.equal(
      roster.decoderSha256,
      sha(prepareExactTerrainDecoder(executableBytes, replay, options)),
    );
    assert.equal(sources.selectionKind, "archive");
    assert.equal(sources.nativeOpening, undefined);
    assert.equal(sources.sourceCensusSha256, roster.censusSha256);
    assert.equal(roster.verifiedModels, 10);
    const { catalog, readModel } = await openChampionModelCatalog(
      modelsFile,
      roster.catalogSha256,
      replay,
      originalSelections,
      { requireArchive: true },
    );
    assert.equal(catalog.sourceCensusSha256, roster.censusSha256);
    const rows = new Map(roster.rows.map((row) => [row.context, row]));
    assert.equal(roster.rows.length, 10);
    assert.equal(rows.size, 10);
    for (const actor of originalSelections) {
      const row = rows.get(actor.context);
      const key = skinKey(actor);
      assert.deepEqual(
        [row?.champion, row?.skinId, row?.key],
        [actor.champion, actor.skinId, key],
      );
      const skin = sources.skins.find(
        (candidate) => skinKey(candidate) === key,
      );
      assert.deepEqual(
        [skin?.archive, skin?.archiveIndexSha256],
        [row.archive, row.archiveIndexSha256],
      );
      assert.equal(catalog.assets[key].model.sha256, row.modelSha256);
      await readModel(actor);
    }
    verifiedOpening = { replaySha256, rows: originalSelections };
  }
  const footerRows = new Map(
    prepared.observations.binding.verified.map(({ context, footerRow }) => [
      context,
      footerRow,
    ]),
  );
  selected = originalSelections.map((row) => {
    const skin = sources.skins.find(
      (candidate) => skinKey(candidate) === skinKey(row),
    );
    assert.ok(skin, "Current actor lacks a source skin");
    return { ...skin, ...row, footerRow: footerRows.get(row.context) };
  });
}
const actors = new Map(selected.map((actor) => [actor.context, actor]));
assert.equal(actors.size, 10);
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
  ...(current ? ["--current-build"] : []),
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
      replay.build,
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
    verifiedOpening,
    ...options,
  },
);
assertExactTerrainReplay(audit, options);
const actorAssets = new Map();
const clips = new Map();

async function readActorAssets(actor) {
  const { context, champion, skinId, footerRow, archive, resources } = actor;
  const source = audit.actors.find((row) => row.context === context);
  const model = current
    ? models.assets[skinKey(actor)]
    : models.actors.find((row) => row.context === context);
  for (const row of [source, model]) {
    assert.equal(row.champion, champion);
    assert.equal(row.skinId, skinId);
    if (!current) assert.equal(row.footerRow, footerRow);
  }
  if (!current) assert.equal(source.creationSha256, actor.creationSha256);
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
    ...(current ? ["--current-build"] : []),
  );
  assert.ok(await Bun.file(out(receiptPath)).exists(), bake.stderr.toString());
  const native = await json(out(receiptPath));
  assert.equal(native.build, replay.build);
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
      replay.build,
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
  if ((flags & 32) !== 0) {
    const portable = readCurrentAnimationCueRequest(
      Buffer.from(payload, "hex"),
      substitution,
    );
    if (portable === null) {
      omit("unsupported-no-blend-wire-layout");
      continue;
    }
    assert.deepEqual(portable, { name, rate, flags });
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
    (authored.magic === "r3d2anmd" &&
      (authored.version === 5 || (current && authored.version === 4)))
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
const catalog = current && createCurrentChampionAnimationCatalog(replay, cues);
const catalogFile = "champion-animation-catalog.json";
if (catalog) await emit(catalogFile, catalog);
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
    ...(catalog && {
      catalog: out(catalogFile),
      catalogSha256: await digest(out(catalogFile)),
    }),
  }),
);
