import { describe, expect, test } from "vitest";
import {
  applyCurrentBuildImageOverrides,
  releaseChartRevisions,
} from "./release-configuration.ts";

describe("applyCurrentBuildImageOverrides", () => {
  test("updates bare and beta pins while preserving the stable workflow pin", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker": "old@sha256:old",
      "shepherdjerred/scout/beta": "old@sha256:old",
      "shepherdjerred/scout/prod": "old@sha256:prod",
      "shepherdjerred/worker/workflows/stable": "old@sha256:old",
      "shepherdjerred/worker/workflows/candidate": "old@sha256:old",
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
      "shepherdjerred/worker/workflows/stable": "old@sha256:old",
      "shepherdjerred/worker/workflows/candidate": `2.0.0-42@sha256:${"a".repeat(64)}`,
    });

    const scoutVersions: Record<string, string> = {
      "shepherdjerred/scout-for-lol/beta": "old@sha256:old",
    };
    applyCurrentBuildImageOverrides(
      scoutVersions,
      JSON.stringify({
        "shepherdjerred/scout-for-lol/beta": `sha256:${"c".repeat(64)}`,
      }),
      "2.0.0-43",
    );
    expect(scoutVersions["shepherdjerred/scout-for-lol/beta"]).toBe(
      `2.0.0-43@sha256:${"c".repeat(64)}`,
    );
  });

  test("retains a divergent workflow candidate while a rollout is active", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker": "old@sha256:old",
      "shepherdjerred/worker/workflows/stable": `2.0.0-41@sha256:${"a".repeat(64)}`,
      "shepherdjerred/worker/workflows/candidate": `2.0.0-42@sha256:${"b".repeat(64)}`,
    };
    applyCurrentBuildImageOverrides(
      versions,
      JSON.stringify({
        "shepherdjerred/worker": `sha256:${"c".repeat(64)}`,
      }),
      "2.0.0-43",
    );
    expect(versions["shepherdjerred/worker/workflows/stable"]).toBe(
      `2.0.0-41@sha256:${"a".repeat(64)}`,
    );
    expect(versions["shepherdjerred/worker/workflows/candidate"]).toBe(
      `2.0.0-42@sha256:${"b".repeat(64)}`,
    );
  });

  test("seeds both workflow tracks on the first capable release", () => {
    const legacy = `2.0.0-12197@sha256:${"a".repeat(64)}`;
    const versions: Record<string, string> = {
      "shepherdjerred/worker/workflows/stable": legacy,
      "shepherdjerred/worker/workflows/candidate": legacy,
    };
    applyCurrentBuildImageOverrides(
      versions,
      JSON.stringify({ "shepherdjerred/worker": `sha256:${"b".repeat(64)}` }),
      "2.0.0-12369",
    );
    expect(versions["shepherdjerred/worker/workflows/stable"]).toBe(
      `2.0.0-12369@sha256:${"b".repeat(64)}`,
    );
    expect(versions["shepherdjerred/worker/workflows/candidate"]).toBe(legacy);
  });

  test("publishes the candidate after stable has been bootstrapped", () => {
    const versions: Record<string, string> = {
      "shepherdjerred/worker/workflows/stable": `2.0.0-12369@sha256:${"b".repeat(64)}`,
      "shepherdjerred/worker/workflows/candidate": `2.0.0-12197@sha256:${"a".repeat(64)}`,
    };
    applyCurrentBuildImageOverrides(
      versions,
      JSON.stringify({ "shepherdjerred/worker": `sha256:${"c".repeat(64)}` }),
      "2.0.0-12370",
    );
    expect(versions["shepherdjerred/worker/workflows/stable"]).toContain(
      "2.0.0-12369",
    );
    expect(versions["shepherdjerred/worker/workflows/candidate"]).toBe(
      `2.0.0-12370@sha256:${"c".repeat(64)}`,
    );
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
