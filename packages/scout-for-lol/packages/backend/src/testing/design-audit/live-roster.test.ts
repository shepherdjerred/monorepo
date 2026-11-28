import { LeaguePuuidSchema } from "@scout-for-lol/data";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  DESIGN_AUDIT_LIVE_MATCH_ID,
  buildDesignAuditLiveRoster,
} from "#src/testing/design-audit/live-roster.ts";

const friendPuuid = LeaguePuuidSchema.parse("q".repeat(78));
const fetchedAt = new Date("2026-06-01T20:06:00.000Z");

describe("the design-audit live game", () => {
  const roster = buildDesignAuditLiveRoster({ friendPuuid, fetchedAt });

  test("names a match id the roster table and the audit's routes can share", () => {
    expect(() =>
      RiotMatchIdSchema.parse(DESIGN_AUDIT_LIVE_MATCH_ID),
    ).not.toThrow();
  });

  test("is a full lobby, five a side, with the friend on Ahri in mid", () => {
    expect(roster.participants).toHaveLength(10);
    expect(roster.participants.filter((p) => p.teamId === 100)).toHaveLength(5);
    const friend = roster.participants.find((p) => p.puuid === friendPuuid);
    expect(friend).toMatchObject({
      championId: 103,
      lane: "middle",
      isTracked: true,
    });
    expect(roster.trackedPuuids).toEqual([friendPuuid]);
  });

  test("each lane appears once per team, so every player has an opponent", () => {
    for (const teamId of [100, 200]) {
      const lanes = roster.participants
        .filter((p) => p.teamId === teamId)
        .map((p) => p.lane);
      expect(new Set(lanes).size).toBe(5);
    }
  });

  test("holds a rank for the friend and form for the strangers it read", () => {
    const friend = roster.participants.find((p) => p.puuid === friendPuuid);
    expect(friend?.rank?.tier).toBe("emerald");
    // Scout read eight of the nine strangers; the friend has no entry at all.
    expect(Object.keys(roster.recentForm)).toHaveLength(8);
    expect(Object.keys(roster.recentForm)).not.toContain(friendPuuid);
  });

  test("gives the page its two lines: a win streak and a champion not played lately", () => {
    const forms = Object.values(roster.recentForm);
    expect(
      forms.some(
        (form) => form.status === "fetched" && form.streak?.length === 5,
      ),
    ).toBe(true);
    expect(
      forms.some(
        (form) => form.status === "fetched" && form.gamesOnChampion === 0,
      ),
    ).toBe(true);
  });
});
