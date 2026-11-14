import { describe, expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/data";
import {
  clashGameFingerprint,
  clashMatchPage,
  decideClashAlias,
} from "./identity.ts";

const participants = [
  [100, 157],
  [100, 64],
  [100, 103],
  [100, 222],
  [100, 412],
  [200, 86],
  [200, 254],
  [200, 61],
  [200, 51],
  [200, 25],
].map(([teamId = 0, championId = 0]) => ({
  teamId,
  championId,
}));

const game = { platform: "NA1", queueId: 700, participants };

describe("clashGameFingerprint", () => {
  test("is stable across participant order and platform casing", () => {
    const fingerprint = clashGameFingerprint(game);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      clashGameFingerprint({
        ...game,
        platform: "na1",
        participants: participants.toReversed(),
      }),
    ).toBe(fingerprint);
    // Pinned: changing the hash input would orphan every stored identity.
    expect(fingerprint).toBe(
      "cb479f3418cb8838de0cd1ace5c297fab0f5395cfa8a182aec2f54dd4b9b4e2e",
    );
  });

  test("tells sides, champions, platforms and queues apart", () => {
    const fingerprint = clashGameFingerprint(game);
    const swapped = participants.map((participant) => ({
      ...participant,
      teamId: participant.teamId === 100 ? 200 : 100,
    }));
    expect(clashGameFingerprint({ ...game, participants: swapped })).not.toBe(
      fingerprint,
    );
    expect(clashGameFingerprint({ ...game, platform: "EUW1" })).not.toBe(
      fingerprint,
    );
    expect(clashGameFingerprint({ ...game, queueId: 720 })).not.toBe(
      fingerprint,
    );
    expect(
      clashGameFingerprint({
        ...game,
        participants: [
          { teamId: 100, championId: 1 },
          ...participants.slice(1),
        ],
      }),
    ).not.toBe(fingerprint);
  });

  test("only a full Clash game has a fingerprint", () => {
    expect(clashGameFingerprint({ ...game, queueId: 420 })).toBeNull();
    expect(
      clashGameFingerprint({ ...game, participants: participants.slice(1) }),
    ).toBeNull();
    expect(
      clashGameFingerprint({
        ...game,
        participants: [
          { teamId: 100, championId: 0 },
          ...participants.slice(1),
        ],
      }),
    ).toBeNull();
  });
});

const canonicalMatchId = RiotMatchIdSchema.parse("NA1_5645340874");
const riotMatchId = RiotMatchIdSchema.parse("NA1_5421167767");

describe("decideClashAlias", () => {
  test("no live game near the start is a miss", () => {
    expect(decideClashAlias({ riotMatchId, candidate: undefined })).toEqual({
      kind: "miss",
    });
  });

  test("a live game the client claimed makes Riot's id an alias only", () => {
    expect(
      decideClashAlias({
        riotMatchId,
        candidate: { canonicalMatchId, processingMatchId: canonicalMatchId },
      }),
    ).toEqual({ kind: "alias-only", canonicalMatchId });
  });

  test("a live game Riot's id claimed is processed under Riot's id", () => {
    expect(
      decideClashAlias({
        riotMatchId,
        candidate: { canonicalMatchId, processingMatchId: riotMatchId },
      }),
    ).toEqual({ kind: "alias-and-process", canonicalMatchId });
  });
});

describe("clashMatchPage", () => {
  test("links whichever id the pipeline processed, live id first", () => {
    expect(
      clashMatchPage({
        canonical: canonicalMatchId,
        alias: riotMatchId,
        processed: new Set([canonicalMatchId, riotMatchId]),
      }),
    ).toBe(canonicalMatchId);
    expect(
      clashMatchPage({
        canonical: canonicalMatchId,
        alias: riotMatchId,
        processed: new Set([riotMatchId]),
      }),
    ).toBe(riotMatchId);
  });

  test("a result-only game with no processed page gets no link", () => {
    expect(
      clashMatchPage({
        canonical: canonicalMatchId,
        alias: riotMatchId,
        processed: new Set(),
      }),
    ).toBeUndefined();
    expect(
      clashMatchPage({
        canonical: canonicalMatchId,
        alias: undefined,
        processed: new Set(),
      }),
    ).toBeUndefined();
  });
});
