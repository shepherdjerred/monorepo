import { assertExactTerrainReplay } from "./native-terrain-byte-codecs.mjs";

export const exactAnnouncerSource = Object.freeze({
  packSha256:
    "774a9a4790e2254816d346973563e6d33245a3836209a8c624227465b19cdefa",
  sampleRate: 44100,
  channels: 2,
});

const replayDigests = new Set([
  "d7cabb0b7ba965f317863d128238847a0b9b0e4cc0cdbcfa3077c537b10fdf2b",
  "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
]);

export const infernalTransitionSource = Object.freeze({
  replaySha256:
    "cea604f9944cb8ca433a0655d742e0b741ae4477e0c7100b59a25b3221562668",
  packSha256:
    "68646f0d4e4e66369036f5da4a53c3733f26aa52cda39e8a83a517ba9aedb117",
});

export const heraldAudioSource = Object.freeze({
  bankSha256:
    "eebec4b0f959e2da1381f8f105b5df8ea7a1703c93a22c8a76d078b05287cb6d",
  channels: 1,
});

export const currentAnnouncerSource = Object.freeze({
  replaySha256:
    "a7eff15aa08dd60e52a9c7e289aa99cfaf06fdd4edd789c1999ccef9fc5b7fa1",
  build: "16.23.841.8428",
  mapSha256: "bf4b0fdfe1070103cad2d5f1e36a637f7c0d11a565f841acdbe3738fac6fe69d",
  globalSha256:
    "d25473c8218476ab44c227a33caa44c599b629c729eab5460085fd63d8fd1485",
});

function readExactMap11Sound(packetReader, replaySha256, witness) {
  const current = replaySha256 === currentAnnouncerSource.replaySha256;
  assertExactTerrainReplay(packetReader, { allowCurrentBuild: current });
  if (
    current
      ? packetReader.build !== currentAnnouncerSource.build
      : replaySha256 !== infernalTransitionSource.replaySha256
  )
    throw Error("Expected the reviewed long Map11 replay");
  const { packets } = packetReader.read(witness.windowEnd);
  let opcode = null;
  let context = 0;
  let timeSeconds;
  for (const packet of packets) {
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (
      packet.stream !== 1 ||
      opcode !== 880 ||
      context !== 0 ||
      packet.chunkOffset !== witness.chunkOffset ||
      packet.blockOffset !== witness.blockOffset
    )
      continue;
    const payload = Buffer.from(packet.payload).toString("hex");
    if (payload !== witness.body || timeSeconds !== undefined)
      throw Error("Unexpected recorded Map11 sound event body");
    timeSeconds = packet.timeSeconds;
  }
  if (timeSeconds === undefined)
    throw Error("Expected one recorded Map11 sound event");
  return timeSeconds;
}

// The exact-build 880 reader accepted both full bodies. The archived
// announcement entries name fixed Wwise events without team/actor tokens.
const elementalSound = {
  wwiseEventId: 3124037542,
  mediaId: 56523430,
  frames: 232332,
  wemSha256: "c91f653429199a5c171a7c059ffd2fc1e29d44cc531a86fcf507e8f3050cbaf7",
};
const heraldSound = {
  name: "OnKillRiftHerald_Spectator",
  wwiseEventId: 2916753568,
  mediaId: 963276642,
  frames: 314891,
  wemSha256: "7177e18178a6d228e26805a855aa856b913ca7b02465f036d787a0da164eed84",
};

export function readExactInfernalTransition(packetReader, replaySha256) {
  const chunkOffset = 7339694;
  const blockOffset = 210869;
  return {
    name: "OnDragonTerrainTransitionInfernal",
    ...elementalSound,
    event: 194,
    timeSeconds: readExactMap11Sound(packetReader, replaySha256, {
      chunkOffset,
      blockOffset,
      windowEnd: 759,
      body: "27a3d203401abc5656565656562f51456bdb",
    }),
    chunkOffset,
    blockOffset,
  };
}

export function readExactHeraldAudio(packetReader, replaySha256) {
  const chunkOffset = 9097928;
  const blockOffset = 518703;
  return {
    ...heraldSound,
    event: 201,
    timeSeconds: readExactMap11Sound(packetReader, replaySha256, {
      chunkOffset,
      blockOffset,
      windowEnd: 923,
      body: "8ca21103a21abc5656fdd056ae56565656fdd056ae56565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656567676767656565656565656560fbf601abc56565656565656fcbc56ae32079d29282c32",
    }),
    chunkOffset,
    blockOffset,
  };
}

const sounds = new Map([
  [
    159,
    {
      name: "OnStartGameMessage1",
      wwiseEventId: 3013702846,
      mediaId: 133352710,
      frames: 127490,
      wemSha256:
        "7b0edc2b930088a971df52f2c1ff7a8e77952e63fd715e75c9fc972ab9cb6f27",
    },
  ],
  [
    157,
    {
      name: "OnMinionsSpawn",
      wwiseEventId: 3292132413,
      mediaId: 696717127,
      frames: 96800,
      wemSha256:
        "e6721bf58cdc5f1ae0888e5238987e04c9d26ada9efb6072366e7d3a429fcbd7",
    },
  ],
]);

const currentCues = [
  [
    159,
    sounds.get(159),
    {
      windowEnd: 21,
      chunkOffset: 40710,
      blockOffset: 119067,
      body: "27a29b03691abc565656565656d15656568f995001ba",
    },
  ],
  [
    157,
    sounds.get(157),
    {
      windowEnd: 32,
      chunkOffset: 40710,
      blockOffset: 146343,
      body: "bfa21c03401abc5656565656562f51456bdb",
    },
  ],
  [
    196,
    { name: "OnDragonTerrainTransitionMountain", ...elementalSound },
    {
      windowEnd: 881,
      chunkOffset: 8391266,
      blockOffset: 190389,
      body: "bfa25203401abc5656565656562f51456bdb",
    },
  ],
  [
    201,
    heraldSound,
    {
      windowEnd: 977,
      chunkOffset: 9353716,
      blockOffset: 370066,
      body: "25a21103a21abc5656b5de56ae56565656b5de56ae56565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656565656567676767656565656565656560fbf601abc56565656565656fcbc56ae32079d29282c32",
    },
  ],
];

export function authoredCurrentAnnouncerEvents() {
  return currentCues.map(([event, sound]) => ({ event, ...sound }));
}

export function readCurrentAnnouncerCandidates(packetReader, replaySha256) {
  if (replaySha256 !== currentAnnouncerSource.replaySha256)
    throw Error("Expected the reviewed current Map11 replay");
  return currentCues.map(([event, sound, witness]) => ({
    ...sound,
    event,
    timeSeconds: readExactMap11Sound(packetReader, replaySha256, witness),
    chunkOffset: witness.chunkOffset,
    blockOffset: witness.blockOffset,
  }));
}

const rotateByte = (byte, bits) =>
  ((byte << bits) | (byte >>> (8 - bits))) & 255;

function eventNumber(payload) {
  // Match the verified opcode 880 body reader's selector-5 prefix.
  if (payload.length < 4 || (payload[0] >>> 7) + 2 * (payload[1] & 3) !== 5)
    return null;
  let value = 0;
  for (let index = 0; index < 3 && index + 2 < payload.length; index++) {
    const byte =
      (rotateByte(rotateByte(payload[index + 2], 4) ^ 255, 6) + 14) & 255;
    value |= (byte & 127) << (7 * index);
    if (byte < 128) return value <= 65535 ? value : null;
  }
  return null;
}

// The Wwise joins use the authored Map11 default Female1/English choice.
// The replay packets establish cue time. Native spectator playback admission is separate.
export function readExactTerrainAnnouncerCandidates(
  packetReader,
  replaySha256,
) {
  assertExactTerrainReplay(packetReader);
  if (!replayDigests.has(replaySha256))
    throw Error("Expected a reviewed Map11 announcer replay");
  const { packets } = packetReader.read(32);
  const cues = [];
  let opcode = null;
  let context = 0;
  for (const packet of packets) {
    if (packet.blockOffset === 0) {
      opcode = null;
      context = 0;
    }
    opcode = packet.explicitOpcode ?? opcode;
    context =
      packet.marker & 32
        ? (context + ((packet.paramBits << 24) >> 24)) >>> 0
        : packet.paramBits;
    if (packet.stream !== 1 || opcode !== 880 || context !== 0) continue;
    const event = eventNumber(packet.payload);
    const sound = sounds.get(event);
    if (sound === undefined) continue;
    cues.push({
      ...sound,
      event,
      timeSeconds: packet.timeSeconds,
      chunkOffset: packet.chunkOffset,
      blockOffset: packet.blockOffset,
    });
  }
  if (
    cues.length !== 2 ||
    cues[0].event !== 159 ||
    cues[1].event !== 157 ||
    !(cues[0].timeSeconds < cues[1].timeSeconds)
  )
    throw Error("Unexpected recorded Map11 announcer events");
  return cues;
}

export function scheduleAnnouncerWindow(cue, replayStart, replayEnd, rate) {
  if (
    ![replayStart, replayEnd, rate].every(Number.isFinite) ||
    replayStart < 0 ||
    replayEnd <= replayStart ||
    rate <= 0
  )
    throw Error("Expected a positive-rate replay time window");
  const start = Math.max(cue.timeSeconds, replayStart);
  const end = Math.min(
    replayEnd,
    cue.timeSeconds + cue.frames / exactAnnouncerSource.sampleRate,
  );
  if (start >= end) return null;
  return {
    startSeconds: (start - replayStart) / rate,
    sourceOffsetSeconds: start - cue.timeSeconds,
    sourceDurationSeconds: end - start,
    rate,
  };
}
