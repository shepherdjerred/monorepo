import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import { invalidTimelineMatchIds } from "./riot-timeline-tools.ts";

describe("timeline acquisition eligibility", () => {
  test("rejects IDs outside the most recent ScoutQL result", () => {
    expect(
      invalidTimelineMatchIds(
        [
          RiotMatchIdSchema.parse("NA1_1"),
          RiotMatchIdSchema.parse("NA1_2"),
          RiotMatchIdSchema.parse("NA1_3"),
        ],
        new Set(["NA1_1", "NA1_3"]),
      ),
    ).toEqual(["NA1_2"]);
  });
});
