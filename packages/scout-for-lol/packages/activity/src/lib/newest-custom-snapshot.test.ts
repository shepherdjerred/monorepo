import { describe, expect, test } from "bun:test";
import {
  CustomNightSnapshotSchema,
  CustomSnapshotEnvelopeSchema,
} from "@scout-for-lol/data";
import { newestCustomSnapshot } from "@/lib/newest-custom-snapshot";

const NOW = "2026-08-15T20:00:00.000Z";

function snapshot(
  revision: number,
  id = "4df1fd22-770f-4f9b-a247-bd97a73c603d",
  state: "RECRUITING" | "ENDED" = "RECRUITING",
) {
  return CustomNightSnapshotSchema.parse({
    id,
    guildId: "12345678901234567",
    guildName: "Guild",
    launchChannelId: "12345678901234567",
    voiceLobbyChannelId: "12345678901234567",
    hostDiscordId: "12345678901234567",
    cohostDiscordIds: [],
    state,
    revision,
    participants: [],
    currentGame: null,
    recruitmentCounts: {
      ready: 0,
      maybe: 0,
      away: 0,
      held: 0,
      remaining: 10,
    },
    recruitmentMessageId: null,
    riotTournamentId: null,
    teamAVoiceChannelId: null,
    teamBVoiceChannelId: null,
    lastActivityAt: NOW,
    expiresAt: NOW,
    endedAt: null,
  });
}

describe("newestCustomSnapshot", () => {
  test("accepts a socket clear envelope", () => {
    expect(
      CustomSnapshotEnvelopeSchema.parse({ kind: "snapshot", snapshot: null }),
    ).toEqual({ kind: "snapshot", snapshot: null });
  });

  test("rejects stale mutation responses after a newer socket snapshot", () => {
    const current = snapshot(7);
    expect(newestCustomSnapshot(current, snapshot(6))).toBe(current);
  });

  test("accepts a strictly newer revision", () => {
    const candidate = snapshot(8);
    expect(newestCustomSnapshot(snapshot(7), candidate)).toBe(candidate);
  });

  test("accepts a snapshot from a new night even at a lower revision", () => {
    const candidate = snapshot(0, "5df1fd22-770f-4f9b-a247-bd97a73c603d");
    expect(newestCustomSnapshot(snapshot(7), candidate)).toBe(candidate);
  });

  test("rejects an old response after the active night is replaced", () => {
    const requested = snapshot(7);
    const current = snapshot(0, "5df1fd22-770f-4f9b-a247-bd97a73c603d");
    const candidate = snapshot(8);
    expect(newestCustomSnapshot(current, candidate, requested)).toBe(current);
  });

  test("rejects an initial response after the socket installs a night", () => {
    const current = snapshot(0, "5df1fd22-770f-4f9b-a247-bd97a73c603d");
    const candidate = snapshot(0);
    expect(newestCustomSnapshot(current, candidate, null, true)).toBe(current);
  });

  test("accepts a newer same-night response after an intervening update", () => {
    const requested = snapshot(7);
    const current = snapshot(8);
    const candidate = snapshot(9);
    expect(newestCustomSnapshot(current, candidate, requested)).toBe(candidate);
  });

  test("clears an ended night when the active query returns null", () => {
    expect(
      newestCustomSnapshot(
        snapshot(7, "4df1fd22-770f-4f9b-a247-bd97a73c603d", "ENDED"),
        null,
      ),
    ).toBe(null);
  });

  test("preserves a newer socket snapshot after an older query returns null", () => {
    const requested = snapshot(7);
    const current = snapshot(8);
    expect(newestCustomSnapshot(current, null, requested)).toBe(current);
  });

  test("clears the cache when the current query returns null", () => {
    const current = snapshot(7);
    expect(newestCustomSnapshot(current, null, current)).toBe(null);
  });
});
