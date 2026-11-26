import { describe, expect, it } from "vitest";

import { cappedCount } from "@shepherdjerred/console-ui";

describe("cappedCount", () => {
  it("shows a list that fits whole", () => {
    expect(cappedCount(0, 15)).toBe(0);
    expect(cappedCount(15, 15)).toBe(15);
  });

  it("shows an overflow of one or two rather than hiding it", () => {
    expect(cappedCount(16, 15)).toBe(16);
    expect(cappedCount(17, 15)).toBe(17);
  });

  it("holds a longer list to the cap", () => {
    expect(cappedCount(18, 15)).toBe(15);
    expect(cappedCount(200, 15)).toBe(15);
  });
});
