import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative } from "node:path";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";
import { createNativeTerrainChampionCreation88Reader } from "./native-terrain-champion-identities.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { readRecordedRiftEffectPackets } from "./recorded-rift-effect-packets.mjs";
import { bindRecordedRiftEffectReceipt } from "./recorded-rift-effect-receipts.mjs";

const executableSha256 =
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const decompress = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });
const keyHex = (key) => key.toString(16).padStart(8, "0");
const vfxClass = mapBinHash("VfxSystemDefinitionData");
const derivedEventFields = [
  "kind",
  "packetEntry",
  "parentChampion",
  "skinKey",
  "resolution",
  "definitionKey",
  "targetCreation",
];

async function readPinnedJson(path, expectedDigest) {
  assert.match(expectedDigest, /^[a-f0-9]{64}$/u);
  const bytes = await readFile(path);
  assert.equal(sha256(bytes), expectedDigest, `Unreviewed input ${path}`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function rejectDerivedEventFields(events) {
  for (const event of events)
    for (const field of derivedEventFields)
      assert.ok(
        !Object.hasOwn(event, field),
        `Receipt row contains catalog-owned field ${field}`,
      );
}

function readOpening(replay, codecBytes) {
  const options = { allowCurrentBuild: true };
  const codecs = createExactTerrainByteCodecs(codecBytes, replay, options);
  const readChampion = createNativeTerrainChampionCreation88Reader(
    replay,
    codecs,
    options,
  );
  const owners = new Map();
  let openingChunk;
  let opcode;
  for (const packet of replayPacketEnvelopes(replay, decompress)) {
    if (packet.stream !== 2) continue;
    openingChunk ??= packet.chunkOffset;
    if (packet.chunkOffset !== openingChunk) break;
    opcode = packet.explicitOpcode ?? opcode;
    if (opcode !== 88) continue;
    const owner = readChampion(packet.payload, { includeSkin: true });
    assert.ok(!owners.has(owner.context), "Repeated opening owner");
    owners.set(owner.context, owner);
  }
  assert.deepEqual(
    [...owners.values()].map(({ champion }) => champion).sort(),
    replay.roster.map(({ champion }) => champion).sort(),
  );
  return owners;
}

function assetReferences(node, paths = new Set()) {
  if (node === null || typeof node !== "object") return paths;
  if (
    node.type === "String" &&
    /^assets\/.+\.(?:dds|tex|sco|scb|skn|skl)$/iu.test(node.value)
  ) {
    paths.add(node.value.toLowerCase());
  }
  for (const value of Object.values(node)) assetReferences(value, paths);
  return paths;
}

async function readDefinition(skin, row, archive) {
  const { path, sha256: sourceSha256, particleName, particlePath } = row.source;
  const bin = readExactMapBin(await archive(path));
  assert.equal(bin.sourceSha256, sourceSha256, `Changed authored BIN ${path}`);
  const matches = bin.objects.filter(({ pathHash }) => pathHash === row.target);
  assert.equal(matches.length, 1);
  const [definition] = matches;
  assert.equal(definition.classHash, vfxClass);
  assert.equal(
    definition.fields[mapBinHash("particleName")]?.value ?? null,
    particleName,
  );
  assert.equal(
    definition.fields[mapBinHash("particlePath")]?.value ?? null,
    particlePath,
  );
  const media = [];
  for (const reference of [...assetReferences(definition)].sort()) {
    if (!archive.has(reference)) {
      media.push({ reference, status: "outside-owner-archive" });
      continue;
    }
    const bytes = await archive(reference);
    media.push({
      reference,
      status: "owner-archive",
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return {
    archive: skin.archive,
    archiveIndexSha256: skin.archiveIndexSha256,
    resolverPathHash: skin.resolverPathHash,
    source: row.source,
    media,
    definition,
  };
}

async function compile({
  replayPath,
  codecPath,
  resources,
  creation,
  stop,
  installation,
  inputDigests,
}) {
  const rawReplay = await Bun.file(replayPath).arrayBuffer();
  const replay = openReplay(rawReplay);
  const identity = {
    build: replay.build,
    protocol: replay.protocol,
    replaySha256: sha256(new Uint8Array(rawReplay)),
  };
  for (const receipt of [resources, creation, stop]) {
    assert.equal(receipt.schema, 1);
    assert.equal(receipt.build, identity.build);
    assert.equal(receipt.protocol, identity.protocol);
  }
  assert.equal(
    resources.kind,
    "exact-native-terrain-champion-effect-resources",
  );
  assert.equal(creation.mode, "creation-inventory");
  assert.equal(creation.lifecycleEvidence, "creation-only");
  assert.equal(creation.events.length, creation.entryCount);
  assert.equal(stop.kind, "recorded-particle-stop-requests");
  assert.equal(stop.opcode, 1164);
  assert.equal(stop.scope.originalBodyDecoder, true);
  assert.equal(stop.scope.originalTargetLookupArgument, true);
  assert.equal(stop.scope.originalBranchSelection, true);
  assert.equal(stop.scope.liveEffectRegistry, false);
  assert.equal(stop.scope.liveStopSideEffects, false);
  for (const receipt of [creation, stop]) {
    assert.equal(receipt.replaySha256, identity.replaySha256);
    assert.equal(receipt.executableSha256, executableSha256);
  }
  assert.ok(
    stop.window[0] <= creation.window[0] &&
      stop.window[1] >= creation.window[1],
  );
  rejectDerivedEventFields(creation.events);
  rejectDerivedEventFields(stop.events);

  const owners = readOpening(replay, await readFile(codecPath));
  const packets = [];
  for (const packet of readRecordedRiftEffectPackets(replay, decompress)) {
    const [start, end] =
      packet.kind === "create" ? creation.window : stop.window;
    if (packet.timeSeconds < start || packet.timeSeconds >= end) continue;
    const { payload, ...envelope } = packet;
    packets.push({ ...envelope, packetSha256: sha256(payload) });
  }
  const events = bindRecordedRiftEffectReceipt(
    packets,
    creation,
    "create",
    creation.window,
  );
  const stops = bindRecordedRiftEffectReceipt(
    packets,
    { ...stop, packetCount: stop.events.length },
    "stop",
    stop.window,
  );
  assert.equal(
    new Set(stops.map(({ sequence }) => sequence)).size,
    stops.length,
  );
  assert.equal(
    new Set(events.map(({ sequence }) => sequence)).size,
    creation.packetCount,
  );
  const archives = new Map();
  const definitions = {};
  const sources = [];
  let previousSequence;
  let packetEntry = 0;
  for (const entry of events) {
    if (entry.sequence !== previousSequence) packetEntry = 0;
    previousSequence = entry.sequence;
    const event = { ...entry, packetEntry: packetEntry++ };
    const parent = owners.get(event.parent);
    if (parent !== undefined) event.parentChampion = parent;
    const owner = owners.get(event.owner);
    if (owner === undefined) {
      sources.push({ ...event, resolution: "owner-outside-opening-roster" });
      continue;
    }
    const skinKey = `${owner.champion.toLowerCase()}-${owner.skinId}`;
    const skin = resources.skins[skinKey];
    assert.equal(
      skin?.champion,
      owner.champion,
      `Missing recorded skin ${skinKey}`,
    );
    assert.equal(skin.skinId, owner.skinId);
    const key = keyHex(event.resourceKey);
    const row = skin.rows.find((entry) => entry.key === key);
    if (row?.status !== "vfx") {
      sources.push({
        ...event,
        skinKey,
        resolution: row?.status ?? "unmapped-key",
      });
      continue;
    }
    const definitionKey = `${skinKey}:${key}`;
    if (definitions[definitionKey] === undefined) {
      if (!archives.has(skin.archive)) {
        archives.set(
          skin.archive,
          await openLocalWad(
            installation,
            skin.archive,
            Bun.zstdDecompressSync,
            skin.archiveIndexSha256,
          ),
        );
      }
      definitions[definitionKey] = await readDefinition(
        skin,
        row,
        archives.get(skin.archive),
      );
    }
    sources.push({ ...event, skinKey, resolution: "vfx", definitionKey });
  }
  const createdByHandle = new Map();
  for (const event of sources) {
    assert.ok(
      !createdByHandle.has(event.handle),
      "Repeated handle in creation window",
    );
    createdByHandle.set(event.handle, event);
  }
  const stopRequests = stops.map((request) => {
    const target = createdByHandle.get(request.target);
    if (target === undefined || target.sequence >= request.sequence)
      return request;
    return {
      ...request,
      targetCreation: {
        sequence: target.sequence,
        packetEntry: target.packetEntry,
      },
    };
  });
  return {
    schema: 1,
    kind: "recorded-rift-effect-source-catalog",
    ...identity,
    executableSha256,
    inputDigests: { ...inputDigests, modelCatalog: resources.catalogSha256 },
    creationWindow: creation.window,
    stopWindow: stop.window,
    scope: "authored-definitions-and-packet-evidence",
    openingRoster: [...owners.values()],
    events: sources,
    stops: stopRequests,
    definitions,
  };
}

const keys = [
  "replay",
  "position-codecs",
  "installation",
  "resources",
  "resources-sha256",
  "creation",
  "creation-sha256",
  "stop",
  "stop-sha256",
  "out",
];
const { values } = parseArgs({
  options: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
});
assert.ok(
  keys.every((key) => values[key]),
  `Required arguments: ${keys.map((key) => "--" + key).join(" ")}`,
);
const [cache, parent] = await Promise.all([
  realpath(".cache"),
  realpath(dirname(values.out)),
]);
const local = relative(cache, parent);
assert.ok(
  !isAbsolute(local) && local.split(/[\\/]/u, 1)[0] !== "..",
  "Expected private .cache output",
);
const inputDigests = {
  resources: values["resources-sha256"],
  creation: values["creation-sha256"],
  stop: values["stop-sha256"],
};
const [resources, creation, stop] = await Promise.all(
  Object.entries(inputDigests).map(([key, digest]) =>
    readPinnedJson(values[key], digest),
  ),
);
const catalog = await compile({
  replayPath: values.replay,
  codecPath: values["position-codecs"],
  installation: values.installation,
  resources,
  creation,
  stop,
  inputDigests,
});
await writeFile(values.out, JSON.stringify(catalog) + "\n", { flag: "wx" });
