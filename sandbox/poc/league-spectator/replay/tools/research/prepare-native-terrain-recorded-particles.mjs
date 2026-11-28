import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import {
  openReplay,
  replayPacketEnvelopes,
} from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/transport.mjs";
import { createNativeTerrainChampionCreation88Reader } from "./native-terrain-champion-identities.mjs";
import { createExactTerrainByteCodecs } from "./native-terrain-positions-944.mjs";
import { readRecordedRiftEffectPackets } from "./recorded-rift-effect-packets.mjs";
import { bindRecordedRiftEffectReceipt } from "./recorded-rift-effect-receipts.mjs";

const build = "16.23.841.8428";
const originalReplaySha256 =
  "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1";
const protocol = "8bbfcd5af2bc92db";
const executableSha256 =
  "c7288a5607c95d50f8333385a0fa84cb089ac53c24375433d6432a1e65c009d7";
// Both reviewed Map11 replays select the same WAD definition f17239e0.
// Skin2 and Skin4 each resolve 0fb3cb06 through the same shared dependency
// 6a43c9a8863bb24d8070adffab0033f445b383faeb06b1be02a691d05e126322.
const reviewedReplays = new Map([
  [originalReplaySha256, 4],
  ["4bb0f94d3ceb19df374c0937a9e59dcc866a5b92e4727b81c6c7d5b3aca970b7", 2],
]);
const resourceDirectory = "recorded-particles";
const indices = "000001000200000002000300";
const sha256 = (bytes) => Bun.CryptoHasher.hash("sha256", bytes, "hex");
const receiptHashes = {
  placements:
    "45ccf6bcd764a79a3dcf4f38050cc32fcb804c19d087bdf5237ef3fa84878af2",
  flash: "529013f9cd79902ecd5f55d28c08cd97d7192726e39c1cddd7381cda0e7e688e",
  bubble: "226097a33606304c46ae50577ccdadbc90468f96fda930b03a18dd081591fffc",
  vertex: "6809fb4a64b928575ded4a01dbdcb50b66a78b01baf79dde46206bfb8964a462",
  pixel: "f603c39a5d8edb7c6d47b073e6a79cf3a6fc77f3228a7f27595070df6439b8f5",
  fight: "cbd5794411aaa4592763941c98a641cc33d14e73e2d291e52a632ad1989d3eb5",
  kaisa: "dfa2b3f7f1e2635adcf55b87ac76a6ba8b8b1ed6c990825c151522d0da1d96eb",
  sennaPlacements:
    "1ef1a99986c75e6c5540afca72b3ee29de38fdc89e089864096c7f585f714045",
  sennaCurves:
    "56661b64ccef26067526153b1101136b9ff1258a2e62779b166421618e7668f1",
  sennaPixel:
    "f299a791ca3bc5c6076071ef03abfdfbc3cd76e80f9bdcf10dd588e25ed325e0",
};
const kaisaTextureDigests = [
  "9467333104f5ce482014c220d593e89eaf3b609c860c2606932c999d67616e7a",
  "33fbb0aa732bf24befe556da253e9fefbac5f19fa1f3551924c4b1f85d63f10b",
];
const sennaTextureDigest =
  "53addee5bec42785b92353da116c1b7cacb58ef0c91e83b0846a7466c0327958";
const textureSources = [
  {
    path: "ASSETS/Shared/Particles/color-firemissile.tex",
    size: 64,
    original:
      "5128e7aea68b7e89d058bb3e61c82974807826d03cc3dd6bfff5bf5638a16179",
    png: "c23e325cc59c7b6aa50a333e61fda6ae676022fd51a1a0eb54c75ccad3a9d84f",
  },
  {
    path: "ASSETS/Characters/Heimerdinger/Skins/Base/Particles/Heimerdinger_Base_AA_Tar.tex",
    size: 256,
    original:
      "4686080e057779023485362c93e7d76aa719d440edb9bcd85adffc2a77d6c5be",
    png: "a177eee4d856d39db66d579c806ce0fe3cfc72063069860fdb74d2e53a1632d9",
  },
  {
    path: "ASSETS/Characters/Heimerdinger/Skins/Base/Particles/Heimerdinger_Base_W_Tar_Bubble.tex",
    size: 256,
    original:
      "90e184c1967a81ca2424a1ec73275f379debcfcddd9b5ecc0b1d15da6b96325a",
    png: "13678fbc62c31d02bc3ae0f66f92ad03b8a25ff87f22d0e23180ced7189a57c1",
  },
];

async function readReceipt(path, key, digest = receiptHashes[key]) {
  const bytes = await Bun.file(path).bytes();
  assert.equal(sha256(bytes), digest, `Unreviewed ${key} receipt`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

const inflate = (input, output) =>
  zstdDecompressSync(input, { maxOutputLength: output.length });

async function openReviewedReplay(path, positionCodecsPath) {
  const bytes = await Bun.file(path).arrayBuffer();
  const replaySha256 = sha256(bytes);
  const reviewedSkin = reviewedReplays.get(replaySha256);
  assert.ok(
    reviewedSkin !== undefined,
    "Replay has no reviewed Map11 skin binding",
  );
  const replay = openReplay(bytes);
  assert.equal(replay.build, build);
  assert.equal(replay.protocol, protocol);
  assert.equal(
    replay.roster.filter((row) => row.champion === "Heimerdinger").length,
    1,
  );
  const options = { allowCurrentBuild: true };
  const codecs = createExactTerrainByteCodecs(
    await Bun.file(positionCodecsPath).bytes(),
    replay,
    options,
  );
  const readChampion = createNativeTerrainChampionCreation88Reader(
    replay,
    codecs,
    options,
  );
  let openingChunk;
  let opcode;
  const openings = [];
  for (const packet of replayPacketEnvelopes(replay, inflate)) {
    if (packet.stream !== 2) continue;
    openingChunk ??= packet.chunkOffset;
    if (packet.chunkOffset !== openingChunk) break;
    opcode = packet.explicitOpcode ?? opcode;
    if (opcode === 88)
      openings.push(readChampion(packet.payload, { includeSkin: true }));
  }
  assert.deepEqual(
    openings.map(({ champion }) => champion).sort(),
    replay.roster.map(({ champion }) => champion).sort(),
    "Opening creation roster differs from the replay footer",
  );
  assert.equal(new Set(openings.map(({ context }) => context)).size, 10);
  const owner = openings.find(({ champion }) => champion === "Heimerdinger");
  assert.equal(owner.skinId, reviewedSkin);
  const effectPackets = Array.from(
    readRecordedRiftEffectPackets(replay, inflate),
    ({ payload, ...packet }) => ({ ...packet, packetSha256: sha256(payload) }),
  );
  return {
    replay,
    replaySha256,
    owner: owner.context,
    openings,
    effectPackets,
  };
}

async function readPlacements(values) {
  const { replay, placements } = values;
  const digest = values["placements-sha256"];
  const codecs = values["position-codecs"];
  if (replay === undefined) {
    assert.ok(
      digest === undefined && codecs === undefined,
      "A replay is required to verify a decoded receipt",
    );
    const events = await readReceipt(placements, "placements");
    assert.equal(events.length, 7);
    return { events, replaySha256: originalReplaySha256, owner: 0x40000151 };
  }
  assert.ok(
    typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest),
    "--placements-sha256 must be the reviewed placement receipt digest",
  );
  assert.ok(codecs?.length, "--position-codecs is required");
  const [opening, receipt] = await Promise.all([
    openReviewedReplay(replay, codecs),
    readReceipt(placements, "placements", digest),
  ]);
  assert.equal(receipt.schema, 1);
  assert.equal(receipt.build, build);
  assert.equal(receipt.protocol, protocol);
  assert.equal(receipt.executableSha256, executableSha256);
  assert.equal(receipt.replaySha256, opening.replaySha256);
  assert.ok(Array.isArray(receipt.events) && receipt.events.length > 0);
  for (const count of [
    receipt.packetCount,
    receipt.groupCount,
    receipt.entryCount,
  ])
    assert.ok(Number.isSafeInteger(count) && count > 0);
  assert.ok(receipt.events.length <= receipt.entryCount);
  const events = bindRecordedRiftEffectReceipt(
    opening.effectPackets,
    receipt,
    "create",
  );
  return { events, ...opening };
}

function compileEffects(
  placements,
  ownerContext,
  duration = Infinity,
  {
    key = 0x0fb3cb06,
    lifetime = Math.fround(0.3),
    secondaryIsZero = false,
  } = {},
) {
  return placements
    .map(({ stamp, handle, owner, context, descriptor }) => {
      assert.equal(owner, ownerContext);
      assert.equal(context, 0);
      assert.equal(descriptor.resourceKey, key);
      assert.equal(descriptor.flags, 0x20);
      assert.deepEqual(descriptor.scaleRate, [1, 1]);
      const [position, secondary, unused] = descriptor.positions;
      assert.equal(position.length, 3);
      assert.ok(
        position.every(
          (value) =>
            Number.isFinite(value) && Number.isFinite(Math.fround(value)),
        ),
      );
      assert.deepEqual(secondary, secondaryIsZero ? [0, 0, 0] : position);
      assert.deepEqual(unused, [0, 0, 0]);
      assert.ok(
        Number.isFinite(stamp) && stamp > 0 && stamp + lifetime <= duration,
      );
      assert.ok(Number.isInteger(handle) && handle > 0 && handle <= 0xffffffff);
      return { handle, start: stamp, position };
    })
    .sort((a, b) => a.start - b.start || a.handle - b.handle);
}

function compileComponent(
  receipt,
  texture,
  expectedLifetime,
  position = [0, 100, 0],
  scale = [100, 100, 100],
) {
  const [insertion] = receipt.inserts;
  assert.equal(receipt.inserts.length, 1);
  assert.equal(insertion.birthClock, 0);
  assert.equal(insertion.lifetime, expectedLifetime);
  assert.deepEqual(insertion.position, position);
  assert.deepEqual(insertion.scale, scale);
  const samples = [];
  for (const [age, count, geometry] of receipt.timeline) {
    // The initializer and the terminal degenerate quad do not establish a
    // visible frame. Positive-age retained samples preserve the original bytes.
    if (age === 0 || Math.fround(age) >= insertion.lifetime) continue;
    assert.ok(Number.isFinite(age) && age > (samples.at(-1)?.age ?? 0));
    assert.equal(count, 1);
    assert.equal(geometry.indices, 12);
    assert.equal(geometry.indexBytes, indices);
    assert.equal(geometry.vertices, 112);
    assert.match(geometry.vertexBytes, /^[a-f0-9]{224}$/);
    samples.push({ age, vertices: geometry.vertexBytes });
  }
  assert.equal(samples.length, 7);
  return { texture, indices, samples, lifetime: insertion.lifetime };
}

async function readTextures(receiptPath) {
  const receipt = await Bun.file(receiptPath).json();
  assert.equal(receipt.length, textureSources.length);
  return Promise.all(
    textureSources.map(async (expected, index) => {
      const row = receipt[index];
      assert.equal(row.texture, expected.path);
      assert.equal(row.width, expected.size);
      assert.equal(row.height, expected.size);
      assert.equal(row.mipLevel, 0);
      assert.equal(row.originalSha256, expected.original);
      assert.equal(row.pngSha256, expected.png);
      // The receipt records absolute paths on its producer. Read the reviewed
      // sibling filenames so a copied receipt works on another machine.
      const bytes = await Bun.file(
        join(dirname(receiptPath), `${index}.png`),
      ).bytes();
      assert.equal(
        sha256(bytes),
        expected.png,
        `Unreviewed texture ${row.texture}`,
      );
      return { path: `${resourceDirectory}/${expected.png}.png`, bytes };
    }),
  );
}

async function compileKaisaFamily(values, opening) {
  assert.equal(opening.replaySha256, originalReplaySha256);
  assert.ok(opening.replay, "A full decoded replay receipt is required");
  // Skin15 resolves a216a0e4 to 14b4ac30 in dependency
  // f50fcbe61a5fe11dbe1c11c83d6d4419ca3dfa892a037766510c989dca3c1f5f.
  const owner = opening.openings.find(({ champion }) => champion === "Kaisa");
  assert.equal(owner?.skinId, 15);
  const [fight, curve, textures] = await Promise.all([
    readReceipt(values["fight-placements"], "fight"),
    readReceipt(values["kaisa-curves"], "kaisa"),
    Promise.all(
      kaisaTextureDigests.map(async (digest, index) => {
        const bytes = await Bun.file(
          join(values["kaisa-textures"], `${index}.png`),
        ).bytes();
        assert.equal(sha256(bytes), digest, "Unreviewed Kai'Sa texture");
        return { path: `${resourceDirectory}/${digest}.png`, bytes };
      }),
    ),
  ]);
  assert.equal(fight.replaySha256, opening.replaySha256);
  assert.equal(fight.executableSha256, executableSha256);
  assert.deepEqual(fight.window, [1712, 1721]);
  const events = fight.events.filter(
    (row) =>
      row.owner === owner.context &&
      row.resourceKey === 0xa216a0e4 &&
      row.parent === 0 &&
      row.status === "detached-placement-confirmed",
  );
  assert.equal(events.length, 2);
  const verifiedEvents = bindRecordedRiftEffectReceipt(
    opening.effectPackets,
    { ...fight, events },
    "create",
    fight.window,
  );
  const lifetime = Math.fround(0.15);
  const effects = compileEffects(
    verifiedEvents,
    owner.context,
    opening.replay.duration,
    {
      key: 0xa216a0e4,
      lifetime,
      secondaryIsZero: true,
    },
  );
  const component = compileComponent(
    curve,
    textures[1].path,
    lifetime,
    [0, 130, 0],
    [250, 150, 150],
  );
  return {
    effects,
    textures,
    components: [
      {
        ...component,
        palette: textures[0].path,
        blend: "src-alpha-one",
        centerY: 130,
      },
    ],
  };
}

function shaderResource({ glsl }) {
  assert.ok(glsl.startsWith("#version 300 es\n"));
  const bytes = new TextEncoder().encode(glsl);
  return { path: `${resourceDirectory}/${sha256(bytes)}.glsl`, bytes };
}

async function compileSennaFamily(values, opening) {
  assert.equal(opening.replaySha256, originalReplaySha256);
  assert.ok(opening.replay, "A full decoded replay receipt is required");
  // Skin18 resolves 06896eea to Senna_Skin16_P_Soul_Death in the shared
  // definition f69be19117da5bc8fb60acef2a4ec0b13453293547f6423cc67908b55898bf86.
  // Emitter 6 uses Aura_Self.tex and the authentic default color-over-life
  // texture. Explicit alphaRef=0 selects the archived all-vision program
  // without alpha testing while preserving the common vertex program.
  const owner = opening.openings.find(({ champion }) => champion === "Senna");
  assert.equal(owner?.skinId, 18);
  const [receipt, curve, base, color, pixel] = await Promise.all([
    readReceipt(values["senna-placements"], "sennaPlacements"),
    readReceipt(values["senna-curves"], "sennaCurves"),
    Bun.file(values["senna-texture"]).bytes(),
    Bun.file(values["senna-color-texture"]).bytes(),
    readReceipt(values["senna-pixel"], "sennaPixel").then(shaderResource),
  ]);
  assert.equal(receipt.schema, 1);
  assert.equal(receipt.build, build);
  assert.equal(receipt.protocol, protocol);
  assert.equal(receipt.replaySha256, opening.replaySha256);
  assert.equal(receipt.executableSha256, executableSha256);
  assert.equal(receipt.events.length, 8);
  const events = bindRecordedRiftEffectReceipt(
    opening.effectPackets,
    receipt,
    "create",
  );
  const textures = [
    [base, sennaTextureDigest],
    [color, kaisaTextureDigests[0]],
  ].map(([bytes, digest]) => {
    assert.equal(sha256(bytes), digest, "Unreviewed Senna texture");
    return { path: `${resourceDirectory}/${digest}.png`, bytes };
  });
  const lifetime = Math.fround(0.4);
  const effects = compileEffects(
    events,
    owner.context,
    opening.replay.duration,
    { key: 0x06896eea, lifetime, secondaryIsZero: true },
  );
  const component = compileComponent(
    curve,
    textures[0].path,
    lifetime,
    [0, 50, 0],
    [250, 1, 1],
  );
  for (const { vertices } of component.samples) {
    const bytes = Buffer.from(vertices, "hex");
    for (let vertex = 0; vertex < 4; vertex++)
      assert.equal(bytes.readFloatLE(vertex * 28 + 8), 0);
  }
  return {
    effects,
    textures,
    pixel,
    components: [
      {
        ...component,
        palette: textures[1].path,
        blend: "src-alpha-one",
        centerY: 50,
        alphaTest: false,
      },
    ],
  };
}

const inputNames = [
  "placements",
  "flash",
  "bubble",
  "textures",
  "vertex",
  "pixel",
  "out",
];
const { values } = parseArgs({
  options: Object.fromEntries(
    [
      ...inputNames,
      "replay",
      "placements-sha256",
      "position-codecs",
      "fight-placements",
      "kaisa-curves",
      "kaisa-textures",
      "senna-placements",
      "senna-curves",
      "senna-texture",
      "senna-color-texture",
      "senna-pixel",
    ].map((name) => [name, { type: "string" }]),
  ),
});
for (const name of inputNames)
  assert.ok(values[name]?.length, `--${name} is required`);
const [placements, flash, bubble, textures, vertex, pixel] = await Promise.all([
  readPlacements(values),
  readReceipt(values.flash, "flash"),
  readReceipt(values.bubble, "bubble"),
  readTextures(values.textures),
  readReceipt(values.vertex, "vertex").then(shaderResource),
  readReceipt(values.pixel, "pixel").then(shaderResource),
]);
const effects = compileEffects(
  placements.events,
  placements.owner,
  placements.replay?.duration,
);
const familyOptions = ["fight-placements", "kaisa-curves", "kaisa-textures"];
let kaisa;
if (familyOptions.some((name) => values[name] !== undefined)) {
  assert.ok(
    familyOptions.every((name) => values[name]?.length),
    "All Kai'Sa inputs are required",
  );
  kaisa = await compileKaisaFamily(values, placements);
}
const sennaOptions = [
  "senna-placements",
  "senna-curves",
  "senna-texture",
  "senna-color-texture",
  "senna-pixel",
];
let senna;
if (sennaOptions.some((name) => values[name] !== undefined)) {
  assert.ok(
    sennaOptions.every((name) => values[name]?.length),
    "All Senna inputs are required",
  );
  senna = await compileSennaFamily(values, placements);
}
const shared = {
  kind: "recorded-native-terrain-particles",
  build,
  replaySha256: placements.replaySha256,
  status: "verified-partial-effects",
  scope: "native-sampled-cold-remap",
};
const shaders = {
  vertex: vertex.path,
  fragment: pixel.path,
  ...(senna ? { noAlphaTestFragment: senna.pixel.path } : {}),
};
const components = [
  compileComponent(flash, textures[1].path, Math.fround(0.2)),
  compileComponent(bubble, textures[2].path, Math.fround(0.3)),
];
const allTextures = Array.from(
  new Map(
    [...textures, ...(kaisa?.textures ?? []), ...(senna?.textures ?? [])].map(
      (texture) => [texture.path, texture],
    ),
  ).values(),
);
const textureFiles = allTextures.map(({ path }) => path);
const manifest =
  kaisa === undefined && senna === undefined
    ? {
        schema: 1,
        ...shared,
        effects,
        components,
        textures: { palette: textures[0].path, files: textureFiles },
        shaders,
      }
    : {
        schema: senna ? 3 : 2,
        ...shared,
        effects: [
          ...effects.map((event) => ({
            ...event,
            family: "heimerdinger-w-impact",
          })),
          ...(kaisa?.effects ?? []).map((event) => ({
            ...event,
            family: "kaisa-e-activation",
          })),
          ...(senna?.effects ?? []).map((event) => ({
            ...event,
            family: "senna-soul-death",
          })),
        ].sort((a, b) => a.start - b.start || a.handle - b.handle),
        families: [
          {
            id: "heimerdinger-w-impact",
            components: components.map((component) => ({
              ...component,
              palette: textures[0].path,
              blend: "one-one",
              centerY: 100,
              ...(senna ? { alphaTest: true } : {}),
            })),
          },
          ...(kaisa
            ? [
                {
                  id: "kaisa-e-activation",
                  components: senna
                    ? kaisa.components.map((component) => ({
                        ...component,
                        alphaTest: true,
                      }))
                    : kaisa.components,
                },
              ]
            : []),
          ...(senna
            ? [{ id: "senna-soul-death", components: senna.components }]
            : []),
        ],
        textures: { files: textureFiles },
        shaders,
      };
assert.equal(
  new Set(manifest.effects.map(({ handle }) => handle)).size,
  manifest.effects.length,
);
// The private player translates the recorded local quads by each packet's
// world position. The cold remap, sampled geometry, and archived texture proof
// do not establish the active match remap, whole factory, or other effects.
const output = resolve(values.out);
await Promise.all(
  [...allTextures, vertex, pixel, ...(senna ? [senna.pixel] : [])].map(
    ({ path, bytes }) =>
      Bun.write(join(output, path), bytes, { createPath: true }),
  ),
);
await Bun.write(
  join(output, "recorded-particles.json"),
  JSON.stringify(manifest),
);
