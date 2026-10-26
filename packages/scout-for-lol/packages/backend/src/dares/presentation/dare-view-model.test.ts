import { DareListItemSchema } from "#src/dares/presentation/dare-view-model.ts";
import { describe, expect, test } from "vitest";

describe("Dare list item response", () => {
  test("list items expose authored English title and per-game-set phrases", () => {
    expect(
      DareListItemSchema.shape.displayTitle.safeParse(
        "Aaron wins a game as support",
      ).success,
    ).toBe(true);
    expect(DareListItemSchema.shape.displayTitle.safeParse(null).success).toBe(
      true,
    );
    expect(
      DareListItemSchema.shape.statusPhrases.safeParse({
        support_win: "support wins",
      }).success,
    ).toBe(true);
    expect(DareListItemSchema.shape.statusPhrases.safeParse(null).success).toBe(
      true,
    );
  });

  test("list items require the challenger's original wording", () => {
    expect(
      DareListItemSchema.shape.originalText.safeParse(
        "I bet Aaron can't win a game playing support",
      ).success,
    ).toBe(true);
    expect(DareListItemSchema.shape.originalText.safeParse("").success).toBe(
      false,
    );
  });
});
