import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  EXPLORE_INTERRUPTED_CAVEAT,
  EXPLORE_STOPPED_CAVEAT,
  ExploreMessageSchema,
  ExploreStreamEventSchema,
} from "@scout-for-lol/data";
import reducerFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-turn-reducer.json" with { type: "json" };
import {
  applyStreamEvent,
  createPendingTurn,
  exploreTurnIsActive,
  markStopping,
  shouldShowExploreSuggestions,
  turnHasLanded,
  visiblePending,
  type ExplorePendingTurn,
} from "#src/lib/explore/explore-turn-state.ts";

/**
 * The reducer sequences live in a shared fixture so Scout Desktop's Rust port
 * (`scout-explore-client`) runs exactly the same cases. Expectations are
 * partial matches, so a case names only what it is about.
 */
const ExpectationSchema = z.record(z.string(), z.unknown());
const StepSchema = z.union([
  z.strictObject({
    event: ExploreStreamEventSchema,
    expectTurn: ExpectationSchema.optional(),
  }),
  z.strictObject({ markStopping: z.literal(true) }),
]);
const TurnCaseSchema = z.strictObject({
  name: z.string().min(1),
  start: z.strictObject({
    conversationId: z.uuid().nullable(),
    question: z.string().nullable(),
    leafIdAtStart: z.uuid().nullable(),
  }),
  steps: z.array(StepSchema),
  expectTurn: ExpectationSchema.optional(),
  visible: z
    .array(
      z.strictObject({
        displayedConversationId: z.uuid().nullable(),
        messages: z.array(ExploreMessageSchema),
        expect: ExpectationSchema,
      }),
    )
    .optional(),
  landed: z
    .array(
      z.strictObject({
        messages: z.array(ExploreMessageSchema),
        expect: z.boolean(),
      }),
    )
    .optional(),
});
const ReducerFixtureSchema = z.looseObject({
  caveats: z.strictObject({ stopped: z.string(), interrupted: z.string() }),
  turns: z.array(TurnCaseSchema).min(1),
});

const fixture = ReducerFixtureSchema.parse(reducerFixture);

function runSteps(
  turnCase: z.infer<typeof TurnCaseSchema>,
): ExplorePendingTurn {
  let turn = createPendingTurn(turnCase.start);
  for (const step of turnCase.steps) {
    if ("markStopping" in step) {
      turn = markStopping(turn);
      continue;
    }
    turn = applyStreamEvent(turn, step.event);
    if (step.expectTurn !== undefined) {
      expect(turn).toMatchObject(step.expectTurn);
    }
  }
  return turn;
}

describe("shared reducer sequences", () => {
  test("name the server's caveats", () => {
    expect(fixture.caveats).toEqual({
      stopped: EXPLORE_STOPPED_CAVEAT,
      interrupted: EXPLORE_INTERRUPTED_CAVEAT,
    });
  });

  test.each(fixture.turns.map((turnCase) => [turnCase.name, turnCase]))(
    "%s",
    (_name, turnCase) => {
      const turn = runSteps(turnCase);
      if (turnCase.expectTurn !== undefined) {
        expect(turn).toMatchObject(turnCase.expectTurn);
      }
      for (const check of turnCase.visible ?? []) {
        expect(
          visiblePending(turn, check.displayedConversationId, check.messages),
        ).toMatchObject(check.expect);
      }
      for (const check of turnCase.landed ?? []) {
        expect(turnHasLanded(turn, check.messages)).toBe(check.expect);
      }
    },
  );
});

describe("exploreTurnIsActive", () => {
  test("treats discovery as active before a run is restored", () => {
    const turn = createPendingTurn({
      conversationId: null,
      question: "Who wins?",
      leafIdAtStart: null,
    });
    expect(exploreTurnIsActive(null, false)).toBe(true);
    expect(exploreTurnIsActive(null, true)).toBe(false);
    expect(exploreTurnIsActive(turn, true)).toBe(true);
  });
});

describe("shouldShowExploreSuggestions", () => {
  test("hides the empty-state copy while a turn is in flight", () => {
    expect(
      shouldShowExploreSuggestions({
        messageCount: 0,
        pendingQuestion: null,
        pendingTurn: createPendingTurn({
          conversationId: null,
          question: "Who wins?",
          leafIdAtStart: null,
        }),
      }),
    ).toBe(false);
  });

  test("shows the empty-state copy only on a blank idle explore view", () => {
    expect(
      shouldShowExploreSuggestions({
        messageCount: 0,
        pendingQuestion: null,
        pendingTurn: null,
      }),
    ).toBe(true);
  });
});
