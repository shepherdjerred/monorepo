import { describe, expect, test } from "vitest";
import {
  applyCurrentBuildImageOverrides,
  releaseChartRevisions,
  scoutImageUsesPostgres,
} from "./release-configuration.ts";

describe("applyCurrentBuildImageOverrides", () => {
  test("updates bare and beta pins but never prod", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker": "old@sha256:old",
      "shepherdjerred/scout/beta": "old@sha256:old",
      "shepherdjerred/scout/prod": "old@sha256:prod",
    };
    applyCurrentBuildImageOverrides(
      versions,
      JSON.stringify({
        "shepherdjerred/worker": `sha256:${"a".repeat(64)}`,
        "shepherdjerred/scout": `sha256:${"b".repeat(64)}`,
      }),
      "2.0.0-42",
    );
    expect(versions).toEqual({
      "shepherdjerred/worker": `2.0.0-42@sha256:${"a".repeat(64)}`,
      "shepherdjerred/scout/beta": `2.0.0-42@sha256:${"b".repeat(64)}`,
      "shepherdjerred/scout/prod": "old@sha256:prod",
    });
  });

  test("fails on an unknown image key", () => {
    expect(() =>
      applyCurrentBuildImageOverrides(
        {},
        JSON.stringify({ unknown: `sha256:${"a".repeat(64)}` }),
        "2.0.0-42",
      ),
    ).toThrow("does not match");
  });

  test("accepts an empty image result without a synthetic version bump", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker": "old@sha256:old",
    };
    applyCurrentBuildImageOverrides(versions, "{}");
    expect(versions).toEqual({
      "shepherdjerred/worker": "old@sha256:old",
    });
  });
});

test("releaseChartRevisions validates exact build revisions", () => {
  expect(releaseChartRevisions(JSON.stringify({ worker: "2.0.0-42" }))).toEqual(
    { worker: "2.0.0-42" },
  );
  expect(() =>
    releaseChartRevisions(JSON.stringify({ worker: "~2.0.0-0" })),
  ).toThrow();
});

test("keeps the promoted SQLite pin below the Postgres cutover", () => {
  expect(scoutImageUsesPostgres("2.0.0-9495")).toBe(false);
  expect(scoutImageUsesPostgres("2.0.0-10760")).toBe(false);
  expect(scoutImageUsesPostgres("2.0.0-10761")).toBe(true);
});
