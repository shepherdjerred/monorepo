import { describe, expect, test } from "bun:test";
import {
  EXPLORE_ANSWER_MAX_LENGTH,
  ExploreAnswerSchema,
} from "@scout-for-lol/data";
import { clampAnswer } from "#src/explore/http-route.ts";

/**
 * A stopped turn is the one answer path that does not go through
 * `ExploreAnswerSchema` before being written, so the cap has to be applied by
 * hand. The assertion that matters is that the result would satisfy the schema
 * every other answer is held to.
 */
describe("clampAnswer", () => {
  test("leaves an ordinary answer alone apart from trimming", () => {
    expect(clampAnswer("  Jinx leads.  ")).toBe("Jinx leads.");
  });

  test("keeps an answer exactly at the limit", () => {
    const exact = "x".repeat(EXPLORE_ANSWER_MAX_LENGTH);
    expect(clampAnswer(exact)).toBe(exact);
  });

  test("truncates past the limit and stays schema-valid", () => {
    const clamped = clampAnswer("x".repeat(EXPLORE_ANSWER_MAX_LENGTH * 3));

    expect(clamped.length).toBe(EXPLORE_ANSWER_MAX_LENGTH);
    expect(clamped.endsWith("…")).toBe(true);
    // The real contract: what every other answer is validated against.
    expect(
      ExploreAnswerSchema.parse({
        answer: clamped,
        queryText: null,
        caveats: [],
        followUps: [],
      }).answer,
    ).toBe(clamped);
  });
});
