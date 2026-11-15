import { describe, expect, test } from "vitest";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import { durableExplorePayload } from "#src/explore/runs/run-manager-start.ts";
import type { CoachTurnRecord } from "#src/coach/audit.ts";

const started = {
  conversationId: "11111111-1111-4111-8111-111111111111",
  title: "Weekly games",
  messageId: "22222222-2222-4222-8222-222222222222",
  question: "Who played the most games?",
  expectedCurrentLeafId: null,
  previousCurrentLeafId: null,
  createdConversation: true,
  createdQuestion: true,
};

const legacyRow = {
  summary: { runId: "33333333-3333-4333-8333-333333333333" },
  started,
  guildIds: ["1337623164146155593"],
};

describe("ExploreDurablePayloadSchema", () => {
  test("a row written before `surface` existed parses as web", () => {
    // Durable Explore runs are enqueued only from the web run manager, so this
    // restores what those rows already meant rather than guessing.
    const parsed = ExploreDurablePayloadSchema.parse(legacyRow);

    expect(parsed.surface).toBe("web");
    expect(parsed.originChannelId).toBeNull();
    expect(parsed.coach).toBeNull();
  });

  test("a coach turn's projected context is read back whole", () => {
    const context = { postgame: { matchId: "NA1_5663121007" } };
    const parsed = ExploreDurablePayloadSchema.parse({
      ...legacyRow,
      surface: "desktop",
      coach: { context },
    });

    expect(parsed.coach).toEqual({ context });
  });

  test("a stored context outside the coach contract is refused", () => {
    expect(() =>
      ExploreDurablePayloadSchema.parse({
        ...legacyRow,
        coach: { context: { postgame: { matchId: "NA1_1", riotId: "x" } } },
      }),
    ).toThrow();
  });

  test("a stored surface is read back rather than defaulted", () => {
    const parsed = ExploreDurablePayloadSchema.parse({
      ...legacyRow,
      surface: "voice",
      originChannelId: "12345678901234567",
    });

    expect(parsed.surface).toBe("voice");
    expect(parsed.originChannelId).toBe("12345678901234567");
  });

  test("an unknown surface is rejected instead of falling back", () => {
    expect(() =>
      ExploreDurablePayloadSchema.parse({ ...legacyRow, surface: "sms" }),
    ).toThrow();
  });
});

/** A coach record that kept `accepted`, the live section withheld. */
function record(
  accepted: CoachTurnRecord["projection"]["context"],
): CoachTurnRecord {
  return {
    deviceId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
    initiation: "player_typed",
    flags: { coachEnabled: true, liveAnswersEnabled: false },
    projection: {
      context: accepted,
      present: ["live", "postgame"],
      accepted: accepted === null ? [] : ["postgame"],
      withheld: [{ section: "live", reason: "live_answers_disabled" }],
    },
  };
}

describe("durableExplorePayload", () => {
  const base = {
    summary: {
      runId: "33333333-3333-4333-8333-333333333333",
      conversationId: started.conversationId,
      questionMessageId: started.messageId,
      leafIdAtStart: null,
      versionCountAtStart: 0,
      startedAt: "2026-11-14T09:12:30.000Z",
    },
    started,
    guildIds: [],
    surface: "desktop",
    originChannelId: null,
  } as const;

  test("stores only what the projection let through", () => {
    const context = { postgame: { matchId: "NA1_5663121007" } };
    const payload = ExploreDurablePayloadSchema.parse(
      JSON.parse(
        durableExplorePayload({
          ...base,
          guildIds: [],
          coach: record(context),
        }),
      ),
    );

    expect(payload.coach).toEqual({ context });
    expect(payload.surface).toBe("desktop");
  });

  test("a turn with nothing kept, or no context, stores none", () => {
    for (const coach of [record(null), null]) {
      const payload = ExploreDurablePayloadSchema.parse(
        JSON.parse(durableExplorePayload({ ...base, guildIds: [], coach })),
      );
      expect(payload.coach).toBeNull();
    }
  });
});
