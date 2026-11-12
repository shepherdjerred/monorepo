import { beforeEach, expect, test, vi } from "vitest";
import { RawMatchSchema, SCOUT_CLIENT_DATA_VERSION } from "@scout-for-lol/data";

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
  const participants = fixture.info.participants.map((participant, index) =>
    index === 0
      ? { ...participant, puuid: null, participantKind: "bot" as const }
      : { ...participant, participantKind: "player" as const },
  );
  const withBot = RawMatchSchema.parse({
    metadata: {
      ...fixture.metadata,
      dataVersion: SCOUT_CLIENT_DATA_VERSION,
      participants: participants.flatMap((participant) =>
        participant.puuid === null ? [] : [participant.puuid],
      ),
    },
    info: { ...fixture.info, participants },
  });

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
