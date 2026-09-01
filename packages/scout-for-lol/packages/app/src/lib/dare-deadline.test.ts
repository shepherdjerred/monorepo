import { describe, expect, test } from "vitest";
import { dareDeadlineDescription } from "#src/lib/dare-deadline.ts";

describe("dareDeadlineDescription", () => {
  test("renders an absolute deadline with its explicit timezone", () => {
    const rendered = dareDeadlineDescription({
      deadlineAt: null,
      deadlineSpec: {
        kind: "absolute",
        deadlineAt: "2026-09-08T19:00:00.000Z",
        timezone: "America/Los_Angeles",
      },
    });

    expect(rendered).toContain("2026");
    expect(rendered).toMatch(/P[DS]T/);
  });

  test("describes a relative deadline before activation", () => {
    expect(
      dareDeadlineDescription({
        deadlineAt: null,
        deadlineSpec: { kind: "relative", days: 7 },
      }),
    ).toBe("7 days after every target accepts");
  });
});
