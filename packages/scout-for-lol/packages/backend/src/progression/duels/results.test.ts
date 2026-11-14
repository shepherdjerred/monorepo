import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data";
import { withFirstParticipantAsBot } from "#src/testing/lcu/bot-match-fixture.ts";
import { classicEndOfGameMatch } from "#src/testing/scout-client/end-of-game-fixtures.ts";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    duelGame: {
      findFirst: mocks.findFirst,
    },
  },
}));

const { duelGameJudgement, duelMatchNeedsTimeline } =
  await import("./results.ts");
const fixture = RawMatchSchema.parse(
  await Bun.file("../../testdata/rift.json").json(),
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findFirst.mockResolvedValue(null);
});

test("does not identify a duel from a repeated roster", async () => {
  await expect(duelMatchNeedsTimeline(fixture)).resolves.toBe(false);

  expect(mocks.findFirst).toHaveBeenCalledTimes(1);
});

test("ignores a Riot tournament code without an observed binding", async () => {
  const tournamentMatch = RawMatchSchema.parse({
    ...fixture,
    info: { ...fixture.info, tournamentCode: "LEGACY-DUEL-CODE" },
  });

  await expect(duelMatchNeedsTimeline(tournamentMatch)).resolves.toBe(false);

  expect(mocks.findFirst).toHaveBeenCalledTimes(1);
});

test("a game with a bot is reviewed, never judged or thrown on", () => {
  const withBot = withFirstParticipantAsBot(fixture);

  expect(duelGameJudgement(withBot, null)).toMatchObject({
    kind: "review",
    evidence: {
      state: "needs_review",
      reason: "The completed game includes a bot or an unresolved player",
      participantPuuids: withBot.metadata.participants,
    },
  });
  expect(duelGameJudgement(fixture, null)).toMatchObject({
    kind: "review",
    evidence: { reason: "Complete timeline evidence is unavailable" },
  });
});

test("a game known only from its end-of-game block is refused with a typed review, never judged", async () => {
  const endOfGame = await classicEndOfGameMatch();

  const judged = duelGameJudgement(endOfGame, null);

  expect(judged).toMatchObject({
    kind: "review",
    evidence: {
      matchId: endOfGame.metadata.matchId,
      state: "needs_review",
      winnerCompetitorId: null,
      timelineComplete: false,
      reason:
        "The game was recorded from the end-of-game screen, which has no timeline to judge a duel objective",
    },
  });
  await expect(duelMatchNeedsTimeline(endOfGame)).resolves.toBe(false);
});
