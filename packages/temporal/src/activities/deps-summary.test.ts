import { describe, expect, it } from "bun:test";
import {
  DEPS_SUMMARY_CLONE_ARGS,
  depsSummaryActivities,
} from "./deps-summary.ts";

describe("depsSummaryActivities", () => {
  describe("cloneAndGetVersionChanges", () => {
    it("uses a blobless full-history main clone instead of a shallow clone", () => {
      expect(DEPS_SUMMARY_CLONE_ARGS).toContain("--filter=blob:none");
      expect(DEPS_SUMMARY_CLONE_ARGS).toContain("--single-branch");
      expect(DEPS_SUMMARY_CLONE_ARGS).toContain("--branch=main");
      expect(
        DEPS_SUMMARY_CLONE_ARGS.some((arg) => arg.startsWith("--shallow")),
      ).toBe(false);
    });
  });

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
