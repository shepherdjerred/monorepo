import { describe, expect, test } from "vitest";
import {
  INITIAL_LEDGER_PAGING,
  adoptSnapshot,
  clampPage,
  nextPage,
  previousPage,
} from "./bucks-ledger-paging.ts";

describe("bucks ledger paging", () => {
  test("adopts the server snapshot exactly once", () => {
    const adopted = adoptSnapshot(INITIAL_LEDGER_PAGING, 42);
    expect(adopted.snapshotId).toBe(42);
    // A later, newer server snapshot must not replace the frozen one.
    expect(adoptSnapshot(adopted, 99).snapshotId).toBe(42);
    expect(
      adoptSnapshot(INITIAL_LEDGER_PAGING, null).snapshotId,
    ).toBeUndefined();
  });

  test("clamps pages to the available range", () => {
    expect(clampPage(-1, 5)).toBe(0);
    expect(clampPage(7, 5)).toBe(4);
    expect(clampPage(0, 0)).toBe(0);
  });

  test("next and previous stay within bounds", () => {
    const start = { page: 0, snapshotId: 42 };
    expect(previousPage(start, 3).page).toBe(0);
    const second = nextPage(start, 3);
    expect(second.page).toBe(1);
    expect(second.snapshotId).toBe(42);
    expect(nextPage(nextPage(second, 3), 3).page).toBe(2);
  });
});
