import { beforeEach, expect, test, vi } from "vitest";
import {
  PlayerConfigEntrySchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/data";
import { parseEndOfGameResult } from "#src/scout-client/canonical/end-of-game-result.ts";
import fixture from "#src/scout-client/canonical/testdata/classic-end-of-game.json";
import { buildScoreboardReport } from "#src/league/tasks/postmatch/scoreboard-report.ts";
import type { ScoutPostmatchRenderMode } from "./postmatch-notification.ts";

const io = vi.hoisted(() => ({
  snapshot: vi.fn(),
  accounts: vi.fn(),
  image: vi.fn(),
  format: vi.fn(() => "Frozen Classic report"),
  fullReport: vi.fn(),
}));
vi.mock("#src/evidence/report-scoreboard.ts", () => ({
  readReportScoreboard: io.snapshot,
}));
vi.mock("#src/database/player-accounts.ts", () => ({
  getAccountConfigsByPuuids: io.accounts,
}));
vi.mock(
  "#src/league/tasks/postmatch/match-report-image.ts",
  async (original) => ({ ...(await original()), createMatchImage: io.image }),
);
vi.mock("#src/league/tasks/postmatch/match-report-generator.ts", () => ({
  generateMatchReport: io.fullReport,
  formatGameCompletionMessage: io.format,
}));
vi.mock("#src/temporal/match/match-context.ts", () => ({
  resolveScoutObservedMatchContext: () => {
    throw new Error("Full match is unavailable");
  },
}));
const { renderPostmatchNotification } =
  await import("./postmatch-notification.ts");
const { attachReportImage } =
  await import("#src/league/tasks/postmatch/match-report-image.ts");
const observer = "scoreboard-observer".padEnd(78, "x");
const matchId = RiotMatchIdSchema.parse("NA1_123456789");
const result = parseEndOfGameResult({
  matchId,
  payload: fixture,
  context: {
    gameData: {
      gameId: 123_456_789,
      queue: { id: 4310, type: "JADE_RANKED_SOLO_5x5", gameMode: "JADE" },
    },
  },
  observer,
  sourceId: "scoreboard",
});
if (result === null) throw new Error("Valid terminal fixture must normalize");
const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const player = PlayerConfigEntrySchema.parse({
  alias: "Scoreboard Scout",
  league: { leagueAccount: { puuid: observer, region: "AMERICA_NORTH" } },
});
beforeEach(() => {
  vi.clearAllMocks();
  io.snapshot.mockResolvedValue({
    version: 1,
    result,
    trackedPuuids: [observer],
  });
  io.accounts.mockResolvedValue([player]);
  io.image.mockResolvedValue(attachReportImage(image, matchId));
});

test("report capability requires each displayed loadout and both sides", () => {
  if (result === null) throw new Error("Fixture must parse");
  const report = buildScoreboardReport(result, [player]);
  expect(report?.teams.blue).toHaveLength(5);
  expect(report?.teams.red).toHaveLength(5);
  expect(report?.players).toHaveLength(1);
  expect(
    buildScoreboardReport(
      {
        ...result,
        participants: result.participants.map((candidate) => ({
          ...candidate,
          items: undefined,
        })),
      },
      [player],
    ),
  ).toBeNull();
});

const modes: ScoutPostmatchRenderMode[] = [
  { kind: "live" },
  { kind: "historical", rankChanges: new Map() },
];
test.each(modes)(
  "frozen scoreboard renders through the existing report artifact handoff: $kind",
  async (mode) => {
    const rendered = await renderPostmatchNotification(matchId, mode);
    expect(rendered).toMatchObject({
      content: "Frozen Classic report",
      components: "none",
      queueId: 4310,
      gameCreation: fixture.data.endOfGameTimestamp,
    });
    expect([...rendered.image]).toEqual([...image]);
    expect(io.image.mock.calls[0]?.[0]).toMatchObject({
      queueType: "classic",
      durationInSeconds: 2213,
    });
    expect(io.format).toHaveBeenCalledWith(["Scoreboard Scout"], "classic");
    expect(io.fullReport).not.toHaveBeenCalled();
  },
);
