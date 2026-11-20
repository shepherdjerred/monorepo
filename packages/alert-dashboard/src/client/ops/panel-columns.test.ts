import { describe, expect, it } from "vitest";

import { columnSplit } from "./panel-columns.ts";

describe("columnSplit", () => {
  it("keeps nothing or a single panel in the first column", () => {
    expect(columnSplit([])).toBe(0);
    expect(columnSplit([7])).toBe(1);
  });

  it("gives each of two panels a column, whatever their sizes", () => {
    expect(columnSplit([11, 1])).toBe(1);
    expect(columnSplit([1, 11])).toBe(1);
  });

  it("cuts where the two columns come out closest in height", () => {
    expect(columnSplit([11, 6, 5, 11])).toBe(2);
    // Maintenance at production volume, in estimated lines.
    expect(columnSplit([67, 24, 18, 38])).toBe(1);
    expect(columnSplit([20, 3, 3, 3])).toBe(1);
    expect(columnSplit([2, 2, 2, 20])).toBe(3);
  });

  it("never leaves the second column empty", () => {
    expect(columnSplit([1, 1, 50])).toBe(2);
    expect(columnSplit([0, 0, 0])).toBe(1);
  });

  it("takes the earlier cut on a tie", () => {
    expect(columnSplit([3, 1, 3])).toBe(1);
    expect(columnSplit([5, 5, 5, 5, 5])).toBe(2);
  });
});
