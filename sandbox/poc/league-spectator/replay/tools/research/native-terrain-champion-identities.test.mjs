import { describe, expect, test } from "bun:test";
import {
  bindNativeTerrainChampionIdentities,
  createNativeTerrainChampionCreation88Reader,
} from "./native-terrain-champion-identities.mjs";

const identity = { build: "16.23.840.6595", protocol: "8bbfcd5af2bc92db" };
const contexts = [0x40000131, 0x40000132, 0x40000133, 0x40000134];
const rotate = (byte, by) => ((byte << by) | (byte >>> (8 - by))) & 0xff;
const codecs = {
  // Identity substitution exercises the packet grammar without authored bytes.
  decodeSyncByte: (byte) =>
    (rotate(((byte + 0x64) & 0xff) ^ 0xff, 6) + 0xed) & 0xff,
};

function invert(decode) {
  const inverse = new Uint8Array(256);
  for (let wire = 0; wire < 256; wire++) inverse[decode(wire)] = wire;
  return (value) => inverse[value];
}

const encodeNameByte = invert((byte) => rotate((byte + 0xfc) & 0xff, 2) ^ 0xa1);
const encodeContextByte = invert(
  (byte) => (((rotate(byte ^ 0xff, 2) ^ 0xf1) + 0xfa) & 0xff) ^ 0x0a,
);
const encodeTeamByte = invert(
  (byte) => rotate(((0x91 - byte) & 0xff) ^ 0xd4, 1) ^ 0x7f,
);

function creationBody(context, champion) {
  const name = new TextEncoder().encode(champion);
  const compact = context ^ 0x40000000;
  return Uint8Array.of(
    0x0f,
    0x08,
    0xa4,
    0xb8,
    0x4a,
    0x1b,
    ...new Uint8Array(15),
    encodeNameByte(name.length),
    ...name.map(encodeNameByte),
    encodeContextByte(compact & 0x7f),
    encodeContextByte((compact >>> 7) | 0x80),
    ...new Uint8Array(13),
  );
}

function teamBody(team) {
  const body = new Uint8Array(1263);
  body[0] = 0x91;
  body[1] = encodeTeamByte(0xec);
  body[2] = encodeTeamByte(9);
  body[1230] = encodeTeamByte(team);
  return body;
}

function fixture({
  champions = ["Beryl", "Amber", "Cobalt", "Amber"],
  footer = ["Amber", "Beryl", "Amber", "Cobalt"],
  verified = [],
} = {}) {
  const claim = new Set(verified.map(({ context }) => context));
  const events = [];
  const binding = {
    verified,
    unresolved: contexts.filter((context) => !claim.has(context)),
    assists: [],
    events,
  };
  const envelope = (explicitOpcode, paramBits, payload) => ({
    explicitOpcode,
    paramBits,
    payload,
    stream: 2,
    chunkOffset: 400,
    marker: 0,
  });
  const teams = [100, 100, 200, 200];
  const packets = [
    ...contexts.map((context, index) =>
      envelope(313, context, teamBody(teams[index])),
    ),
    ...champions
      .map((champion, index) =>
        envelope(88, 0, creationBody(contexts[index], champion)),
      )
      .reverse(),
  ];
  return {
    packetReader: {
      ...identity,
      read: () => ({ keyframe: { timeSeconds: 0, chunkOffset: 400 }, packets }),
    },
    observations: {
      ...identity,
      binding,
      roster: footer.map((champion, index) => ({
        champion,
        team: teams[index],
      })),
    },
  };
}

describe("exact terrain champion identities", () => {
  test("keeps native default skin selectors distinct", () => {
    const read = createNativeTerrainChampionCreation88Reader(identity, codecs);
    for (const [selector, skinId] of [
      [0, 2],
      [3, 0xffffffff],
      [4, 1],
      [6, 0],
    ]) {
      const payload = creationBody(contexts[0], "Beryl");
      payload[4] |= (selector & 1) << 7;
      payload[5] = (payload[5] & ~3) | (selector >>> 1);
      expect(read(payload, { includeSkin: true })).toEqual({
        context: contexts[0],
        champion: "Beryl",
        skinId,
      });
    }
  });

  test("decodes the internal creation identity and verifies its whole body width", () => {
    const read = createNativeTerrainChampionCreation88Reader(identity, codecs);
    const payload = creationBody(contexts[0], "Beryl");
    expect(read(payload)).toEqual({ context: contexts[0], champion: "Beryl" });
    expect(() => read(payload.subarray(0, -1))).toThrow("hero creation width");
    const unknown = new Uint8Array(payload);
    unknown[0] |= 0x80;
    expect(() => read(unknown)).toThrow("Unsupported opcode 88");
    expect(() =>
      createNativeTerrainChampionCreation88Reader(
        { ...identity, build: "16.23.839.9929" },
        codecs,
      ),
    ).toThrow("Expected exact 16.23.840.6595 replay protocol");
  });

  test("joins champion and team independently of either packet or footer order", () => {
    const prepared = fixture();
    const { binding, coverage } = bindNativeTerrainChampionIdentities(
      prepared,
      codecs,
    );
    expect(binding.verified).toEqual(
      contexts.map((context, index) => ({
        context,
        footerRow: [2, 1, 4, 3][index],
      })),
    );
    expect(binding.events).toBe(prepared.observations.binding.events);
    expect(binding.assists).toBe(prepared.observations.binding.assists);
    expect(coverage).toEqual({
      openingCreations: 4,
      independentlyMatched: 4,
      corroboratedCombatMatches: 0,
      unresolved: 0,
    });
    expect(prepared.observations.binding.verified).toEqual([]);
  });

  test("preserves ambiguous same-team identities and rejects independent conflicts", () => {
    const ambiguous = fixture({
      champions: ["Amber", "Amber", "Cobalt", "Amber"],
      footer: ["Amber", "Amber", "Amber", "Cobalt"],
    });
    const { binding, coverage } = bindNativeTerrainChampionIdentities(
      ambiguous,
      codecs,
    );
    expect(binding.unresolved).toEqual(contexts.slice(0, 2));
    expect(coverage.independentlyMatched).toBe(2);
    expect(coverage.unresolved).toBe(2);

    const conflicting = fixture({
      verified: [{ context: contexts[0], footerRow: 1 }],
    });
    expect(() =>
      bindNativeTerrainChampionIdentities(conflicting, codecs),
    ).toThrow("Opcode 88 and combat participant evidence disagree");
  });
});
