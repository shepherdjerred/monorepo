import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import {
  CoachGameContextSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";
import coachFixtures from "@scout-for-lol/data/scout-client/coach-context.fixtures.json" with { type: "json" };
import type { ExploreAgentParams } from "#src/explore/analysis/agent-types.ts";
import { testExploreLoadoutCard } from "#src/explore/loadout-card-test-fixture.ts";
import {
  buildMessages,
  loadoutCardReplayContext,
  matchCardReplayContext,
} from "#src/explore/agent.ts";
import { gameContextDigest } from "#src/explore/tools/game-state-tools.ts";

describe("matchCardReplayContext", () => {
  test("preserves card order, match IDs, and team results for follow-ups", () => {
    expect(
      matchCardReplayContext([
        {
          size: "L",
          match: {
            matchId: RiotMatchIdSchema.parse("NA1_5635906026"),
            teams: [
              { teamId: 100, win: true, kills: 91 },
              { teamId: 200, win: false, kills: 88 },
            ],
          },
        },
        {
          size: "S",
          match: {
            matchId: RiotMatchIdSchema.parse("NA1_5635906025"),
            teams: [
              { teamId: 100, win: false, kills: 10 },
              { teamId: 200, win: true, kills: 20 },
            ],
          },
        },
      ]),
    ).toBe(
      "\n\n[Match cards shown in order]\nCard 1 (L): NA1_5635906026; Team 100 won (91 kills); Team 200 lost (88 kills).\nCard 2 (S): NA1_5635906025; Team 100 lost (10 kills); Team 200 won (20 kills).",
    );
  });

  test("adds no replay context when the assistant showed no cards", () => {
    expect(matchCardReplayContext([])).toBe("");
  });
});

describe("loadoutCardReplayContext", () => {
  test("keeps unknown item IDs in the conversation replay", () => {
    const card = testExploreLoadoutCard("L");
    card.finalItems[0] = { slot: 0, itemId: 999_999, name: null };

    expect(loadoutCardReplayContext([card])).toContain(
      "final build Unknown item ID 999999",
    );
  });
});

describe("buildMessages with a game context", () => {
  const coach = CoachGameContextSchema.parse(coachFixtures.valid[0]?.body);
  const asker = DiscordAccountIdSchema.parse("160509172704739328");

  function params(extra: Partial<ExploreAgentParams>): ExploreAgentParams {
    return {
      runId: "3d8f1a62-7b4c-4e29-9a05-c61e2f7b8d43",
      conversationId: "7c3e5a91-2b64-4d0f-8e17-5a9c4b2d6f30",
      subject: { kind: "discord_user", id: asker },
      question: "What should I build next?",
      history: [],
      guildIds: [],
      requesterId: asker,
      originChannelId: null,
      surface: "desktop",
      abortSignal: new AbortController().signal,
      emit: () => Promise.resolve(),
      ...extra,
    };
  }

  test("the digest rides just ahead of the question", () => {
    const messages = buildMessages(params({ coach }));
    expect(messages.slice(-2)).toEqual([
      { role: "user", content: gameContextDigest(coach) },
      { role: "user", content: "What should I build next?" },
    ]);
  });

  test("a turn without one sends the question alone", () => {
    for (const extra of [{}, { coach: null }]) {
      expect(buildMessages(params(extra))).toEqual([
        { role: "user", content: "What should I build next?" },
      ]);
    }
  });
});
