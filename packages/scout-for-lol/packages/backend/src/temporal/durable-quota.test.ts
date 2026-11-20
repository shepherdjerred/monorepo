import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_STEPS,
} from "@scout-for-lol/data";
import { z } from "zod";
import coachFixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };

/**
 * The shared in-game profile as a spoken turn reaches it, and the in-game
 * allowance it is admitted by, against a stand-in client so no database runs.
 */

const database = vi.hoisted(() => ({
  runCount: vi.fn(),
  runCreate: vi.fn(),
  coachCount: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutInteractiveRun: {
      count: database.runCount,
      create: database.runCreate,
    },
    scoutCoachTurn: { count: database.coachCount },
  },
}));

const { prisma } = await import("#src/database/index.ts");
const { projectGameContext } = await import("#src/coach/context-policy.ts");
const { coachRunSettings, IN_GAME_MODEL } =
  await import("#src/coach/execution-profile.ts");
const {
  createDurableExploreRunReservation,
  durableExploreQuotaRejection,
  IN_GAME_COACH_QUOTA_RULES,
} = await import("./durable-quota.ts");
const { exploreAudioMicros } = await import("#src/explore/spending/ledger.ts");

const complete = z
  .record(z.string(), z.unknown())
  .parse(coachFixtures.valid[0]?.body);
const OWNER = DiscordAccountIdSchema.parse("160509172704739328");

/** What the policy lets through for `raw` on a spoken turn. */
function spoken(raw: Record<string, unknown>, liveAnswersEnabled = true) {
  const result = projectGameContext(raw, {
    initiation: "player_voice",
    flags: { coachEnabled: true, liveAnswersEnabled },
  });
  if (!result.ok) throw new Error("the fixture context was refused");
  return result.projection.context;
}

describe("the shared in-game profile on a spoken turn", () => {
  test("a live game runs the fast model, low, short and on the in-game quota", () => {
    expect(coachRunSettings(spoken({ live: complete["live"] }))).toEqual({
      model: IN_GAME_MODEL,
      reasoningEffort: "low",
      maxSteps: 6,
      maxOutputTokens: 1200,
      quota: "in_game",
    });
    expect(IN_GAME_MODEL).toBe("gpt-6-luna");
  });

  test.each([
    ["no context", undefined],
    ["a post-game review", spoken({ postgame: complete["postgame"] })],
    [
      "a live section the kill switch withheld",
      spoken({ live: complete["live"] }, false),
    ],
  ])("%s keeps the Explore settings", (_case, context) => {
    expect(coachRunSettings(context)).toEqual({
      model: null,
      reasoningEffort: "high",
      maxSteps: EXPLORE_MAX_STEPS,
      maxOutputTokens: EXPLORE_MAX_OUTPUT_TOKENS,
      quota: "explore",
    });
  });
});

type CountQuery = { readonly where: Record<string, unknown> };

/** Answer each count from the given functions, through the mocked client. */
function counts(answers: {
  readonly runs: (where: Record<string, unknown>) => number;
  readonly coachTurns: (where: Record<string, unknown>) => number;
}): void {
  database.runCount.mockImplementation(async ({ where }: CountQuery) =>
    answers.runs(where),
  );
  database.coachCount.mockImplementation(async ({ where }: CountQuery) =>
    answers.coachTurns(where),
  );
}

describe("the in-game allowance", () => {
  const now = Date.UTC(2026, 10, 14, 21, 30, 15);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("an in-game turn is not refused by Explore's spent question windows", async () => {
    // Every Explore window reads as spent, and no in-game turn was asked.
    counts({
      runs: (where) =>
        "state" in where && !("createdAt" in where) ? 0 : 10_000,
      coachTurns: () => 0,
    });

    expect(
      await durableExploreQuotaRejection(OWNER, now, prisma, "explore"),
    ).not.toBeNull();
    expect(
      await durableExploreQuotaRejection(OWNER, now, prisma, "in_game"),
    ).toBeNull();
    expect(database.coachCount).toHaveBeenCalledTimes(
      IN_GAME_COACH_QUOTA_RULES.length,
    );
    for (const [query] of database.coachCount.mock.calls) {
      expect(query).toMatchObject({
        where: {
          ownerId: OWNER,
          sectionsAccepted: { hasSome: ["champSelect", "live"] },
        },
      });
    }
  });

  test("it refuses past its own minute limit, with the wait until that window turns", async () => {
    const [minute] = IN_GAME_COACH_QUOTA_RULES;
    counts({ runs: () => 0, coachTurns: () => minute.limit });

    expect(
      await durableExploreQuotaRejection(OWNER, now, prisma, "in_game"),
    ).toEqual({
      reason: `You have used ${minute.limit.toString()} of ${minute.limit.toString()} in-game questions for this minute.`,
      retryAfterSeconds: 45,
    });
  });

  test("the active-run limits still apply to an in-game turn", async () => {
    counts({
      runs: (where) => ("ownerId" in where ? 1 : 0),
      coachTurns: () => 0,
    });

    expect(
      await durableExploreQuotaRejection(OWNER, now, prisma, "in_game"),
    ).toMatchObject({ reason: "You already have an Explore answer running." });
    expect(database.coachCount).not.toHaveBeenCalled();
  });

  test("its limits widen with their windows and leave a long game room", () => {
    const limits = IN_GAME_COACH_QUOTA_RULES.map((rule) => rule.limit);
    expect(limits).toEqual([...limits].sort((a, b) => a - b));
    // A question every thirty seconds through an hour-long game.
    expect(IN_GAME_COACH_QUOTA_RULES[1]).toMatchObject({ window: "hour" });
    expect(IN_GAME_COACH_QUOTA_RULES[1].limit).toBeGreaterThanOrEqual(120);
  });

  test.each([
    ["in_game", true],
    ["explore", false],
  ] as const)(
    "a %s reservation is quota-exempt: %s",
    async (allowance, exempt) => {
      await createDurableExploreRunReservation({
        database: prisma,
        id: "3d8f1a62-7b4c-4e29-9a05-c61e2f7b8d43",
        ownerId: OWNER,
        conversationId: "7c3e5a91-2b64-4d0f-8e17-5a9c4b2d6f30",
        payload: "{}",
        allowance,
      });
      expect(database.runCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ quotaExempt: exempt }),
      });
    },
  );
});

describe("audio spend", () => {
  test("is priced by the minute of audio, never below one micro", () => {
    expect(exploreAudioMicros("gpt-4o-transcribe", 60_000)).toBe(6000);
    expect(exploreAudioMicros("gpt-4o-mini-tts", 30_000)).toBe(7500);
    expect(exploreAudioMicros("gpt-4o-transcribe", 200)).toBe(20);
    expect(exploreAudioMicros("gpt-4o-mini-tts", 0)).toBe(1);
    expect(() => exploreAudioMicros("gpt-4o-transcribe", -1)).toThrow();
  });
});
