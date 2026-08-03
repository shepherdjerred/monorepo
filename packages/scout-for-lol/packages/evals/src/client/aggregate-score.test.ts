import { describe, expect, test } from "bun:test";

import { formatAggregateRatingScore } from "#client/aggregate-score.ts";

describe("formatAggregateRatingScore", () => {
  test("displays the exact simple mean of all three ratings", () => {
    expect(
      formatAggregateRatingScore({
        anchoredness: 3,
        entertainment: 2,
        styleRecognizability: 3,
      }),
    ).toBe("2.67 / 3");
    expect(
      formatAggregateRatingScore({
        anchoredness: 1,
        entertainment: 2,
        styleRecognizability: 2,
      }),
    ).toBe("1.67 / 3");
  });

  test("waits until every dimension is selected", () => {
    expect(
      formatAggregateRatingScore({
        anchoredness: 3,
        entertainment: undefined,
        styleRecognizability: 3,
      }),
    ).toBe("Select all three scores");
  });
});
