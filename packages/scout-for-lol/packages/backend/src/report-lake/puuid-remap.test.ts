import { describe, expect, test } from "vitest";
import {
  composePuuidRemap,
  puuidRemapFingerprint,
  remapRawJson,
} from "#src/report-lake/puuid-remap.ts";

const OLD_A = "OLD_A_puuid";
const NEW_A = "NEW_A_puuid";
const OLD_B = "OLD_B_puuid";
const NEW_B = "NEW_B_puuid";
const map = new Map([
  [OLD_A, NEW_A],
  [OLD_B, NEW_B],
]);

describe("remapRawJson", () => {
  test("returns the payload untouched when no migration has run", () => {
    const payload = { metadata: { participants: [OLD_A] } };
    expect(remapRawJson(payload, new Map())).toBe(payload);
  });

  test("translates PUUIDs in a Match-V5 shape, metadata and participants alike", () => {
    const match = {
      metadata: { matchId: "NA1_1", participants: [OLD_A, OLD_B, "UNTRACKED"] },
      info: {
        gameId: 1,
        participants: [
          { puuid: OLD_A, championName: "Nautilus", win: true },
          { puuid: "UNTRACKED", championName: "Lux", win: false },
        ],
      },
    };
    expect(remapRawJson(match, map)).toEqual({
      metadata: { matchId: "NA1_1", participants: [NEW_A, NEW_B, "UNTRACKED"] },
      info: {
        gameId: 1,
        participants: [
          { puuid: NEW_A, championName: "Nautilus", win: true },
          { puuid: "UNTRACKED", championName: "Lux", win: false },
        ],
      },
    });
  });

  test("reaches PUUIDs nested inside timeline frames", () => {
    const timeline = {
      info: {
        frames: [{ events: [{ type: "KILL", killer: { puuid: OLD_B } }] }],
      },
    };
    expect(remapRawJson(timeline, map)).toEqual({
      info: {
        frames: [{ events: [{ type: "KILL", killer: { puuid: NEW_B } }] }],
      },
    });
  });

  test("leaves untracked identifiers and non-string values alone", () => {
    const payload = {
      puuid: "SOMEONE_ELSE",
      gameId: 12_345,
      ranked: true,
      endedAt: null,
    };
    expect(remapRawJson(payload, map)).toEqual(payload);
  });

  test("composes retained mappings across key transitions", () => {
    const composed = composePuuidRemap(
      new Map([
        [OLD_A, OLD_B],
        [OLD_B, NEW_B],
      ]),
    );
    expect(composed.get(OLD_A)).toBe(NEW_B);
    expect(remapRawJson({ participants: [OLD_A] }, composed)).toEqual({
      participants: [NEW_B],
    });
  });

  test("collapses a return transition cycle toward its latest domain", () => {
    const composed = composePuuidRemap(
      new Map([
        [OLD_A, NEW_A],
        [NEW_A, OLD_A],
      ]),
    );
    expect(composed).toEqual(
      new Map([
        [OLD_A, OLD_A],
        [NEW_A, OLD_A],
      ]),
    );
  });
});

describe("puuidRemapFingerprint", () => {
  test("reports a stable sentinel when nothing was migrated", () => {
    expect(puuidRemapFingerprint(new Map())).toBe("none");
  });

  test("changes when the mapping changes, so a fold falls back to a rebuild", () => {
    const before = puuidRemapFingerprint(new Map([[OLD_A, NEW_A]]));
    const after = puuidRemapFingerprint(
      new Map([
        [OLD_A, NEW_A],
        [OLD_B, NEW_B],
      ]),
    );
    expect(before).not.toBe(after);
    expect(before).not.toBe("none");
  });

  test("does not depend on insertion order", () => {
    const forward = puuidRemapFingerprint(
      new Map([
        [OLD_A, NEW_A],
        [OLD_B, NEW_B],
      ]),
    );
    const reverse = puuidRemapFingerprint(
      new Map([
        [OLD_B, NEW_B],
        [OLD_A, NEW_A],
      ]),
    );
    expect(forward).toBe(reverse);
  });
});
