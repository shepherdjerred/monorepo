import { describe, expect, it } from "bun:test";
import { depsSummaryActivities } from "./deps-summary.ts";

describe("depsSummaryActivities", () => {
  describe("fetchReleaseNotes", () => {
    it("skips unsupported datasources", async () => {
      const result = await depsSummaryActivities.fetchReleaseNotes([
        {
          name: "some-package",
          datasource: "custom.papermc",
          registryUrl: undefined,
          oldVersion: "1.0",
          newVersion: "2.0",
        },
      ]);

      expect(result.notes).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });
  });
});
