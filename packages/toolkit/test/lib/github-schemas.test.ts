import { describe, expect, test } from "vitest";
import { ReviewsResponseSchema } from "#lib/github/schemas.ts";

describe("GitHub review schemas", () => {
  test("accepts pending reviews without a submission timestamp", () => {
    const result = ReviewsResponseSchema.safeParse({
      reviews: [
        {
          author: { login: "reviewer" },
          state: "PENDING",
          submittedAt: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
