import { describe, expect, test } from "vitest";
import {
  ExploreAnswerSchema,
  ExploreAnswerWireSchema,
  CoachOptionsSchema,
} from "#src/model/reports/explore-answer.ts";
import {
  ExploreMessageSchema,
  ExploreStreamMessageSchema,
} from "#src/model/reports/explore.ts";

const WIRE = {
  answer: "Two directions to weigh.",
  spokenAnswer: null,
  title: null,
  queryText: null,
  includeVisualization: false,
  matchCards: [],
  loadoutCards: [],
  caveats: [],
  followUps: [],
  coachOptions: null,
};
const OPTION = { label: "Ornn", rationale: "Adds the frontline you lack." };

describe("coachOptions on the answer wire", () => {
  test("the wire schema requires the key and accepts null", () => {
    const { coachOptions: _omitted, ...without } = WIRE;
    expect(ExploreAnswerWireSchema.safeParse(without).success).toBe(false);
    expect(ExploreAnswerWireSchema.safeParse(WIRE).success).toBe(true);
  });

  test("two to four options pass; one or five are refused", () => {
    const second = { label: "Ahri", rationale: "Mobile and safe." };
    expect(CoachOptionsSchema.safeParse([OPTION]).success).toBe(false);
    expect(CoachOptionsSchema.safeParse([OPTION, second]).success).toBe(true);
    expect(
      CoachOptionsSchema.safeParse(Array.from({ length: 4 }, () => OPTION))
        .success,
    ).toBe(true);
    expect(
      CoachOptionsSchema.safeParse(Array.from({ length: 5 }, () => OPTION))
        .success,
    ).toBe(false);
  });

  test("an option needs a label and a short rationale, and no other key", () => {
    expect(
      CoachOptionsSchema.safeParse([OPTION, { label: "", rationale: "x" }])
        .success,
    ).toBe(false);
    expect(
      CoachOptionsSchema.safeParse([
        OPTION,
        { ...OPTION, rationale: "x".repeat(201) },
      ]).success,
    ).toBe(false);
    expect(
      CoachOptionsSchema.safeParse([OPTION, { ...OPTION, command: "pick" }])
        .success,
    ).toBe(false);
  });

  test("an answer stored before the field existed reads as no options", () => {
    const { coachOptions: _omitted, ...stored } = WIRE;
    expect(ExploreAnswerSchema.parse(stored).coachOptions).toBeNull();
  });
});

describe("coachOptions on stored and streamed messages", () => {
  const message = {
    id: "9b2e4c7d-1f53-4a8b-9d66-8f3c2e5b0a12",
    role: "assistant",
    parentId: null,
    content: "Two directions.",
    createdAt: "2026-11-14T18:00:00.000Z",
  };

  test("a message without the key parses to null, so an old row still reads", () => {
    expect(ExploreMessageSchema.parse(message).coachOptions).toBeNull();
  });

  test("the terminal stream event never carries them", () => {
    expect(ExploreStreamMessageSchema.shape).not.toHaveProperty("coachOptions");
    expect(
      ExploreStreamMessageSchema.safeParse({
        ...message,
        coachOptions: [OPTION, OPTION],
      }).success,
    ).toBe(false);
  });
});
