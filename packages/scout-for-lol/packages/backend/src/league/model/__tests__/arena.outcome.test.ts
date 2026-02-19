import { describe, it, expect } from "bun:test";
import type { RawParticipant } from "@scout-for-lol/data";
import { getArenaPlacement } from "@scout-for-lol/backend/league/model/match.ts";
import { makeTestParticipant } from "@scout-for-lol/backend/testing/riot-mocks.ts";

function makeParticipant(extra: Partial<RawParticipant> = {}): RawParticipant {
  return makeTestParticipant(extra);
}

describe("arena placement extraction", () => {
  it("returns placement within 1..8", () => {
    for (let p = 1; p <= 8; p++) {
      const dto = makeParticipant({ placement: p, playerSubteamId: 1 });
      expect(getArenaPlacement(dto)).toBe(p);
    }
  });

  it("throws when placement is invalid", () => {
    const dto = makeParticipant({ placement: 0, playerSubteamId: 1 });
    expect(() => getArenaPlacement(dto)).toThrow();
  });
});
