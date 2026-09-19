import { describe, expect, test } from "vitest";
import { guardCrossGroupChanges } from "./transfer-guard.ts";
import type { MonarchCategory } from "../monarch/types.ts";
import type { ProposedChange } from "../classifier/types.ts";

function category(
  id: string,
  name: string,
  groupType: string,
): MonarchCategory {
  return {
    id,
    name,
    order: 0,
    isSystemCategory: false,
    isDisabled: false,
    group: { id: `group-${groupType}`, name: groupType, type: groupType },
  };
}

const categories: MonarchCategory[] = [
  category("ccp", "Credit Card Payment", "transfer"),
  category("xfer", "Transfer", "transfer"),
  category("sw", "Software", "expense"),
  category("rent", "Rent", "expense"),
  category("int", "Interest", "income"),
  category("unc", "Uncategorized", "expense"),
];

function change(overrides: Partial<ProposedChange>): ProposedChange {
  return {
    transactionId: "t1",
    transactionDate: "2026-01-01",
    merchantName: "Apple",
    amount: -100,
    currentCategory: "Credit Card Payment",
    currentCategoryId: "ccp",
    proposedCategory: "Software",
    proposedCategoryId: "sw",
    confidence: "high",
    type: "recategorize",
    ...overrides,
  };
}

describe("guardCrossGroupChanges", () => {
  test("demotes transfer → expense recategorization to a flag", () => {
    const { changes, demoted } = guardCrossGroupChanges(
      [change({})],
      categories,
    );
    expect(demoted).toBe(1);
    expect(changes[0]?.type).toBe("flag");
    expect(changes[0]?.reason).toContain("Cross-group");
  });

  test("demotes expense → transfer recategorization", () => {
    const { demoted } = guardCrossGroupChanges(
      [
        change({
          currentCategoryId: "sw",
          currentCategory: "Software",
          proposedCategoryId: "xfer",
          proposedCategory: "Transfer",
        }),
      ],
      categories,
    );
    expect(demoted).toBe(1);
  });

  test("allows transfer → transfer moves", () => {
    const { demoted } = guardCrossGroupChanges(
      [change({ proposedCategoryId: "xfer", proposedCategory: "Transfer" })],
      categories,
    );
    expect(demoted).toBe(0);
  });

  test("allows expense → expense and income-side moves", () => {
    const { demoted } = guardCrossGroupChanges(
      [
        change({
          currentCategoryId: "sw",
          currentCategory: "Software",
          proposedCategoryId: "rent",
          proposedCategory: "Rent",
        }),
      ],
      categories,
    );
    expect(demoted).toBe(0);
  });

  test("exempts Uncategorized as the source", () => {
    const { demoted } = guardCrossGroupChanges(
      [
        change({
          currentCategoryId: "unc",
          currentCategory: "Uncategorized",
          proposedCategoryId: "xfer",
          proposedCategory: "Transfer",
        }),
      ],
      categories,
    );
    expect(demoted).toBe(0);
  });

  test("demotes a split whose legs cross out of the transfer group", () => {
    const { changes, demoted } = guardCrossGroupChanges(
      [
        change({
          type: "split",
          proposedCategory: "SPLIT",
          proposedCategoryId: "",
          splits: [
            {
              itemName: "Rent",
              amount: -80,
              categoryId: "rent",
              categoryName: "Rent",
            },
            {
              itemName: "Software",
              amount: -20,
              categoryId: "sw",
              categoryName: "Software",
            },
          ],
        }),
      ],
      categories,
    );
    expect(demoted).toBe(1);
    expect(changes[0]?.type).toBe("flag");
  });

  test("allows a split within the same group", () => {
    const { demoted } = guardCrossGroupChanges(
      [
        change({
          currentCategoryId: "sw",
          currentCategory: "Software",
          type: "split",
          proposedCategory: "SPLIT",
          proposedCategoryId: "",
          splits: [
            {
              itemName: "Rent",
              amount: -80,
              categoryId: "rent",
              categoryName: "Rent",
            },
            {
              itemName: "More",
              amount: -20,
              categoryId: "sw",
              categoryName: "Software",
            },
          ],
        }),
      ],
      categories,
    );
    expect(demoted).toBe(0);
  });

  test("passes existing flags through untouched", () => {
    const { changes, demoted } = guardCrossGroupChanges(
      [change({ type: "flag", reason: "inconsistent" })],
      categories,
    );
    expect(demoted).toBe(0);
    expect(changes[0]?.reason).toBe("inconsistent");
  });
});
