import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  MatchIdSchema,
  PlayerConfigEntrySchema,
  RawMatchSchema,
  type RawTimeline,
} from "@scout-for-lol/data";
import type { TimelineSelection } from "#src/scout-client/canonical-match.ts";

const mocks = vi.hoisted(() => ({
  selection: vi.fn<() => Promise<TimelineSelection>>(async () => ({
    source: "RIOT",
  })),
  record: vi.fn(async () => true),
  fetchMatchTimeline: vi.fn<() => Promise<RawTimeline | undefined>>(),
}));

vi.mock("#src/scout-client/canonical-match.ts", () => ({
  readTimelineSelection: mocks.selection,
}));
vi.mock("#src/report-store/live-ingest.ts", () => ({
  recordTimelineForReportStore: mocks.record,
}));
vi.mock("./match-data-fetcher.ts", () => ({
  fetchMatchTimeline: mocks.fetchMatchTimeline,
}));

const {
  fetchTimelineForDare,
  fetchTimelineForDuelProgression,
  fetchTimelineForProgression,
  fetchTimelineIfStandardMatch,
} = await import("./match-report-standard.ts");

const fixtureUrl = new URL(
  "../../../../../../testdata/rift.json",
  import.meta.url,
);

async function arenaFixture() {
  const input: unknown = await Bun.file(fixtureUrl).json();
  const match = RawMatchSchema.parse(input);
  const participant = match.info.participants[0];
  if (participant === undefined) {
    throw new Error("Timeline fixture requires a participant");
  }
  return {
    match: RawMatchSchema.parse({
      ...match,
      info: { ...match.info, queueId: 1700, gameMode: "CHERRY" },
    }),
    players: [
      PlayerConfigEntrySchema.parse({
        alias: "Arena timeline player",
        league: {
          leagueAccount: {
            puuid: participant.puuid,
            region: "AMERICA_NORTH",
          },
        },
      }),
    ],
  };
}

const clientTimeline: RawTimeline = {
  metadata: { dataVersion: "local-1", matchId: "NA1_1", participants: [] },
  info: { frameInterval: 60_000, frames: [], gameId: 1, participants: [] },
};

describe("required progression timelines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("rejects an unsupported Arena timeline before progression advances", async () => {
    const fixture = await arenaFixture();
    const matchId = MatchIdSchema.parse(fixture.match.metadata.matchId);

    await expect(
      fetchTimelineForProgression(fixture.match, matchId, fixture.players),
    ).rejects.toThrow("match processing must retry");
    await expect(
      fetchTimelineIfStandardMatch(fixture.match, matchId, fixture.players),
    ).resolves.toBeUndefined();
    await expect(
      fetchTimelineForDuelProgression(fixture.match, matchId, fixture.players),
    ).resolves.toBeUndefined();
  });
});

describe("timelines for client-sourced matches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("stages the client's timeline and never asks Riot", async () => {
    mocks.selection.mockResolvedValueOnce({
      source: "SCOUT_CLIENT",
      timeline: clientTimeline,
    });
    const fixture = await arenaFixture();
    const matchId = MatchIdSchema.parse(fixture.match.metadata.matchId);

    await expect(
      fetchTimelineForDare(fixture.match, matchId, fixture.players),
    ).resolves.toBe(clientTimeline);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        timeline: clientTimeline,
        source: "timeline_scout_client",
      }),
    );
    expect(mocks.fetchMatchTimeline).not.toHaveBeenCalled();
  });

  test("treats a client match without a timeline as a final miss", async () => {
    // Riot can't see the game, so even a required timeline is never coming;
    // retrying would block the match forever.
    mocks.selection.mockResolvedValueOnce({
      source: "SCOUT_CLIENT",
      timeline: null,
    });
    const fixture = await arenaFixture();
    const matchId = MatchIdSchema.parse(fixture.match.metadata.matchId);

    await expect(
      fetchTimelineForProgression(fixture.match, matchId, fixture.players),
    ).resolves.toBeUndefined();
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.fetchMatchTimeline).not.toHaveBeenCalled();
  });
});
