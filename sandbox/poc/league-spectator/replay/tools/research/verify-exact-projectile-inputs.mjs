import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { replayTimedPacketEnvelopes } from "../../replay-packet-clock.mjs";
import { openReplay, replayPacketEnvelopes } from "../../transport.mjs";
import { actorSpellHash } from "../archived-actor-spells.mjs";
import { identifyArchivedFxFormat } from "../archived-fx-formats.mjs";
import { readExactMapBin } from "../exact-map-bin.mjs";
import { mapBinHash } from "../map-scene-assets.mjs";
import { openLocalWad } from "../wad.mjs";
import { readZoeRecastEmitterInput } from "./exact-projectile-emitter-input.mjs";

const [
  replayPath,
  decoderPath,
  installation,
  rosterPath,
  output,
  python,
  ...pythonArgs
] = process.argv.slice(2);
if (!python)
  throw Error(
    "Usage: bun verify-exact-projectile-inputs.mjs <short-rofl> <mac-executable> <installation> <reviewed-champion-manifest> <private-output-json> <python-executable> [python-arguments...]",
  );

const outputPath = resolve(output);
const outputParent = await realpath(dirname(outputPath));
const privateCache = await realpath(".cache");
assert(
  outputParent === privateCache || outputParent.startsWith(privateCache + sep),
  "Projectile evidence output must stay in private .cache",
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hashHex = (value) => value.toString(16).padStart(8, "0");
const field = (object, name) => object?.fields[mapBinHash(name)];
const build = "16.23.840.6595";
const protocol = "8bbfcd5af2bc92db";
const replayBytes = await Bun.file(replayPath).arrayBuffer();
const replaySha256 = sha256(new Uint8Array(replayBytes));
const replay = openReplay(replayBytes);
assert.equal(replay.build, build);
assert.equal(replay.protocol, protocol);
assert.equal(
  replaySha256,
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
);
const roster = await Bun.file(rosterPath).json();
assert.equal(roster.build, build);
assert.equal(roster.protocol, protocol);
assert.equal(roster.replaySha256, replaySha256);
assert.equal(
  sha256(await Bun.file(`${installation}/Game/League of Legends.exe`).bytes()),
  "89d73a9e6d886c291f5b3cf42904e5e8b014148b56490d2b6c862ea96cc9f156",
);

const selected = new Map([
  [
    1073742880,
    {
      champion: "Zoe",
      skinId: 20,
      missileSpell: "ZoeQMis2",
      cast: "ZoeQRecast",
      stopExpected: true,
    },
  ],
  [
    1073743207,
    {
      champion: "Zoe",
      skinId: 20,
      missileSpell: "ZoeQMis2",
      cast: "ZoeQRecast",
      stopExpected: true,
    },
  ],
  [
    1073742919,
    {
      champion: "Orianna",
      skinId: 42,
      missileSpell: "OrianaIzuna",
      cast: "OrianaIzunaCommand",
      stopExpected: false,
    },
  ],
]);
const creations = new Map();
const stops = new Map();
const controllerPackets = [];
const componentPackets = [];
let opcode = null;
let context = 0;
const inflate = (input, target) =>
  zstdDecompressSync(input, { maxOutputLength: target.byteLength });
for (const packet of replayTimedPacketEnvelopes(
  replayPacketEnvelopes(replay, inflate),
)) {
  if (packet.blockOffset === 0) {
    opcode = null;
    context = 0;
  }
  opcode = packet.explicitOpcode ?? opcode;
  context =
    packet.marker & 32
      ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
      : packet.paramBits;
  if (packet.stream !== 1 || !selected.has(context)) continue;
  if (opcode === 639) {
    assert(!creations.has(context));
    creations.set(context, packet);
  } else if (opcode === 479) {
    assert.equal(packet.payload.length, 0);
    assert(!stops.has(context));
    stops.set(context, packet);
  } else if (opcode === 337) {
    controllerPackets.push({ context, packet });
  } else if (opcode === 784) {
    componentPackets.push({ context, packet });
  }
}
assert.equal(creations.size, selected.size);
const command = fileURLToPath(
  new URL("./exact-projectile-reader.py", import.meta.url),
);
const result = Bun.spawnSync([python, ...pythonArgs, command, decoderPath], {
  stdin: Buffer.from(
    JSON.stringify({
      creation: [...creations].map(([id, { payload }]) => [
        id,
        Buffer.from(payload).toString("hex"),
      ]),
      controller: controllerPackets.map(({ packet }) =>
        Buffer.from(packet.payload).toString("hex"),
      ),
      components: componentPackets.map(({ context, packet }) => [
        context,
        Buffer.from(packet.payload).toString("hex"),
      ]),
    }),
  ),
  stderr: "inherit",
});
assert.equal(result.exitCode, 0);
const {
  decoderSha256,
  records,
  controllerVectors,
  componentVectors,
  componentActivations,
} = JSON.parse(result.stdout.toString());
const emitterReader = fileURLToPath(
  new URL("./exact-projectile-emitter-reader.py", import.meta.url),
);
assert.equal(records.length, selected.size);
assert.equal(controllerVectors.length, 55);
assert.equal(controllerVectors.length, controllerPackets.length);
assert.equal(componentVectors.length, selected.size);
assert.equal(componentVectors.length, componentPackets.length);
assert.equal(componentActivations.length, 2);

async function readAuthoredInput(expected, actor) {
  assert.equal(actor.skinId, expected.skinId);
  const wad = await openLocalWad(
    installation,
    actor.archive,
    Bun.zstdDecompressSync,
  );
  const champion = actor.champion.toLowerCase();
  const basePath = `data/characters/${champion}/${champion}.bin`;
  const base = readExactMapBin(await wad(basePath));
  const skinPath = actor.resources.skin.reference;
  const skin = readExactMapBin(await wad(skinPath));
  assert.equal(skin.sourceSha256, actor.resources.skin.sha256);
  const spell = base.objects.filter(
    (object) =>
      object.classHash === mapBinHash("SpellObject") &&
      (field(object, "ObjectName") ?? field(object, "mScriptName"))?.value ===
        expected.missileSpell,
  );
  assert.equal(spell.length, 1);
  const spellData = field(spell[0], "mSpell");
  const key = field(spellData, "mMissileEffectKey");
  assert.equal(key.type, "Hash");
  const resolvers = skin.objects.filter(
    ({ classHash }) => classHash === mapBinHash("ResourceResolver"),
  );
  assert.equal(resolvers.length, 1);
  const links = field(resolvers[0], "resourceMap").entries.filter(
    (entry) => entry.key.type === "Hash" && entry.key.value === key.value,
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].value.type, "ObjectLink");
  const effectPathHash = hashHex(links[0].value.value);
  const trees = [{ path: skinPath, bin: skin }];
  for (const path of new Set(
    skin.dependencies.filter((path) => path.includes("_Multi_")),
  ))
    trees.push({ path, bin: readExactMapBin(await wad(path)) });
  const hits = trees.flatMap(({ path, bin }) =>
    bin.objects
      .filter(({ pathHash }) => pathHash === effectPathHash)
      .map((effect) => ({ path, sha256: bin.sourceSha256, effect })),
  );
  assert.equal(hits.length, 1);
  const [{ path, sha256: effectSourceSha256, effect }] = hits;
  assert.equal(effect.classHash, mapBinHash("VfxSystemDefinitionData"));
  const emitters = [
    ...(field(effect, "complexEmitterDefinitionData")?.elements ?? []),
    ...(field(effect, "simpleEmitterDefinitionData")?.elements ?? []),
  ];
  assert(emitters.length > 0);
  const resources = new Map();
  async function readResources(property) {
    if (
      property.type === "WadChunkLink" &&
      property.value !== "0000000000000000"
    ) {
      const key = property.value;
      if (resources.has(key)) return;
      const bytes = await wad.byHash(BigInt(`0x${key}`));
      resources.set(key, {
        wadHash: key,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
      return;
    }
    if (
      property.type === "String" &&
      /^assets[/\\].+\.(tex|dds|skn|sco|scb|skl|anm)$/i.test(property.value)
    ) {
      const key = property.value;
      if (resources.has(key)) return;
      const bytes = await wad(key);
      resources.set(key, {
        path: key,
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
      return;
    }
    for (const child of [
      ...Object.values(property.fields ?? {}),
      ...(property.elements ?? []),
      ...(property.entries ?? []).flatMap(({ key, value }) => [key, value]),
    ])
      await readResources(child);
  }
  await readResources(effect);
  assert(resources.size > 0);
  const zoeRecast = expected.missileSpell === "ZoeQMis2";
  const reviewedEmitter = zoeRecast
    ? readZoeRecastEmitterInput(effect, resources)
    : undefined;
  if (reviewedEmitter) {
    for (const [lane, resource] of Object.entries(reviewedEmitter.textures)) {
      const bytes = await wad(resource.path);
      assert.equal(sha256(bytes), resource.sha256);
      const format = identifyArchivedFxFormat(bytes);
      const dimensions = lane === "base" ? [128, 128, 12] : [8, 8, 10];
      assert.equal(format.format, "tex");
      assert.deepEqual([format.width, format.height, format.extendedFormat], dimensions);
      assert.equal(format.translation, "pinned-texture-mip0");
      reviewedEmitter.textures[lane] = { ...resource, format };
    }
    const native = Bun.spawnSync(
      [python, ...pythonArgs, emitterReader, decoderPath],
      {
        stdin: Buffer.from(JSON.stringify(reviewedEmitter.authored)),
        stderr: "inherit",
      },
    );
    assert.equal(native.exitCode, 0);
    reviewedEmitter.nativeEmitterObservation = JSON.parse(
      native.stdout.toString(),
    );
  }
  return {
    spell: expected.missileSpell,
    spellObjectPathHash: spell[0].pathHash,
    spellSource: { path: basePath, sha256: base.sourceSha256 },
    skin: { id: actor.skinId, path: skinPath, sha256: skin.sourceSha256 },
    movement: zoeRecast ? readZoeAcceleration(spellData) : undefined,
    recordedSourcePlacement: zoeRecast
      ? readZoeRecordedSourcePlacement(spellData)
      : undefined,
    collisionComponents: zoeRecast ? readZoeCollisionComponents(spellData) : undefined,
    effect: {
      propertyKey: hashHex(key.value),
      name: field(effect, "particleName").value,
      pathHash: effectPathHash,
      source: { path, sha256: effectSourceSha256 },
      emitters: emitters.length,
      resources: [...resources.values()],
      reviewedEmitter,
    },
  };
}

function readZoeCollisionComponents(spellData) {
  const spec = field(spellData, "mMissileSpec");
  const components = spec.fields.a0f69e3c;
  assert.equal(components.type, "Container");
  const classHashes = components.elements.map((component) => {
    assert.equal(component.type, "Struct");
    assert.deepEqual(Object.keys(component.fields), []);
    return component.classHash;
  });
  assert.deepEqual(classHashes, ["d9f51778", "fb0dfd42"]);
  return classHashes;
}

function readZoeRecordedSourcePlacement(spellData) {
  assert.equal(field(spellData, "mCastType")?.value, 3);
  assert.equal(field(spellData, "mParticleStartOffset"), undefined);
  const turnFields = [
    "MissileEffectMaxTurnSpeedDegreesPerSecond",
    "MissileEffectMaximumAngleDegrees",
  ];
  assert(turnFields.every((name) => field(spellData, name) === undefined));
  // The exact SpellData registration binds mParticleStartOffset to +0x4b0.
  // The native default constructor zeros +0x4b0 through +0x4bb.
  return {
    castType: 3,
    authoredOffsetPresent: false,
    localOffsetXYZ: [0, 0, 0],
    authoredEffectTurnOverridesPresent: false,
  };
}

function readZoeAcceleration(spellData) {
  const movement = field(field(spellData, "mMissileSpec"), "movementComponent");
  assert.equal(movement?.classHash, mapBinHash("AcceleratingMovement"));
  assert.deepEqual(movement.fields["d6a12457"], { type: "Bool", value: true });
  assert.deepEqual(movement.fields["2df5584d"], { type: "Bool", value: false });
  // Exact native class registration maps these hashed fields to +0x5c through
  // +0x68. The movement factory copies the first three into the integrator's
  // properties and uses the fourth as its starting speed.
  const fields = ["82ff2d4c", "c8847abf", "ef7f4569", "82f1d787"];
  const values = fields.map((hash) => {
    const property = movement.fields[hash];
    assert.equal(property.type, "F32");
    assert(Number.isFinite(property.value));
    return property.value;
  });
  const [acceleration, minimumSpeed, maximumSpeed, startingSpeed] = values;
  return {
    classHash: movement.classHash,
    acceleration,
    minimumSpeed,
    maximumSpeed,
    startingSpeed,
    authoredGroundRebase: true,
    authoredTrackTarget: false,
  };
}

const assets = new Map();
const events = [];
for (const record of records) {
  const expected = selected.get(record.entity);
  const creation = creations.get(record.entity);
  const stop = stops.get(record.entity);
  const componentEvents = componentPackets.flatMap(
    ({ context, packet }, index) => {
      if (context !== record.entity) return [];
      assert(packet.timeSeconds > creation.timeSeconds);
      if (stop) assert.equal(packet.timeSeconds, stop.timeSeconds);
      const [entityArgument, ...vector] = componentVectors[index];
      return [
        {
          timeSeconds: packet.timeSeconds,
          entityArgument,
          vector,
          bodySha256: sha256(packet.payload),
        },
      ];
    },
  );
  assert.equal(componentEvents.length, 1);
  const recordedControllerVectors = controllerPackets.flatMap(
    ({ context, packet }, index) => {
      if (context !== record.entity) return [];
      assert(
        packet.timeSeconds >= creation.timeSeconds &&
          packet.timeSeconds <= stop?.timeSeconds,
      );
      return [
        {
          timeSeconds: packet.timeSeconds,
          vector: controllerVectors[index],
          bodySha256: sha256(packet.payload),
          bodyHex: Buffer.from(packet.payload).toString("hex"),
        },
      ];
    },
  );
  assert.equal(record.sourceName, expected.champion);
  const actor = roster.actors.find(
    ({ context }) => context === record.sourceContext,
  );
  assert.equal(actor.champion, expected.champion);
  assert.equal(record.castHash, actorSpellHash(expected.cast));
  assert.equal(
    record.requestedMissileSpellHash,
    actorSpellHash(expected.missileSpell),
  );
  assert.equal(Boolean(stop), expected.stopExpected);
  assert.equal(record.bodyBytes, creation.payload.length);
  if (stop) assert(stop.timeSeconds > creation.timeSeconds);
  if (!assets.has(expected.missileSpell))
    assets.set(expected.missileSpell, await readAuthoredInput(expected, actor));
  let verifiedBirthPositionXYZ;
  if (assets.get(expected.missileSpell).recordedSourcePlacement) {
    // Positive packet age takes the separate replication-position branch.
    assert.equal(record.packetElapsedSeconds, 0);
    assert.equal(record.forcedRecordedSource, true);
    assert.equal(record.nativeRecordedSourceStarts.length, 3);
    for (const sample of record.nativeRecordedSourceStarts)
      assert.deepEqual(sample.positionXYZ, record.castSourceXYZ);
    verifiedBirthPositionXYZ = record.castSourceXYZ;
  }
  const verifiedCollisionDispatch = componentActivations.find(
    (activation) => activation.entity === record.entity,
  );
  if (assets.get(expected.missileSpell).collisionComponents) {
    const [{ entityArgument, vector }] = componentEvents;
    assert.equal(verifiedCollisionDispatch.companionDispatches, 1);
    assert.deepEqual(verifiedCollisionDispatch.childArguments, [
      [entityArgument, ...vector],
    ]);
  }
  events.push({
    ...record,
    cast: expected.cast,
    missileSpell: expected.missileSpell,
    verifiedBirthPositionXYZ,
    verifiedCollisionDispatch,
    creation: {
      opcode: 639,
      timeSeconds: creation.timeSeconds,
      bodySha256: sha256(creation.payload),
    },
    presentationStop: stop
      ? { opcode: 479, timeSeconds: stop.timeSeconds }
      : null,
    recordedControllerVectors,
    componentEvents,
  });
}

await Bun.write(
  join(outputParent, basename(outputPath)),
  JSON.stringify(
    {
      schema: 1,
      build,
      protocol,
      replaySha256,
      decoderSha256,
      scope:
        "Offline decoded cast, controller and component-dispatch vectors, requested missile spell, authored resources, zero-age projectile birth and collision child activation for Zoe Q, and recorded presentation-stop clocks. With supplied scene inputs, the original missile-head emitter writes an indexed CPU quad and produces texture, sampler, shader-stage, alpha-test and blend/depth requests. Replay emitter activation, world-space attachment, collision outcome, GPU material acquisition, draw, and particle retirement remain unverified.",
      nativeEntries: {
        packetReader: 0x1321380,
        descriptorConverter: 0x842310,
        missileSpellRegistryQuery: 0x863d80,
        recordedSourcePlacement: 0x88dc00,
        placementInitializer: 0x88da10,
        packetElapsedReadStart: 0x8920e2,
        packetElapsedReadEnd: 0x892132,
        positiveElapsedPositionGuard: 0x892162,
        particleStartOffsetRegistration: 0x8b5fcc,
        particleStartOffsetDefaults: 0x8b15ff,
        controllerVectorReader: 0x13d4500,
        controllerUpdateCallback: 0x893530,
        componentPacketReader: 0x13267a0,
        componentCallback: 0x8936f0,
        componentDispatch: 0x87ccc0,
        zoeCollisionComponentFactory: 0x880c10,
        zoeCompanionComponentFactory: 0x880a40,
        collisionComponentCallback: 0x88ebf0,
        collisionChildBoundary: 0x88f270,
        presentationStopSubscription: 0x890a02,
        presentationStopCallback: 0x893510,
        missileStop: 0x87cfb0,
      },
      events,
      assets: [...assets.values()],
    },
    null,
    2,
  ),
);
