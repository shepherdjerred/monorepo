import { describe, expect, test } from "vitest";
import { invalidTimelineMatchIds } from "./riot-timeline-tools.ts";

describe("timeline acquisition eligibility", () => {
  test("rejects IDs outside the most recent ScoutQL result", () => {
    expect(
      invalidTimelineMatchIds(
        ["NA1_1", "NA1_2", "NA1_3"],
        new Set(["NA1_1", "NA1_3"]),
      ),
    ).toEqual(["NA1_2"]);
  });
});
