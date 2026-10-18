import { describe, expect, test } from "vitest";
import {
  publicationImageDigests,
  releaseChartRevisions,
} from "./release-configuration.ts";

describe("publicationImageDigests", () => {
  test("preserves explicit publication identities without selecting a runtime", () => {
    const originals = {
      "shepherdjerred/temporal-worker": `sha256:${"a".repeat(64)}`,
      "shepherdjerred/the-storm-server/candidate": `sha256:${"b".repeat(64)}`,
      "shepherdjerred/the-storm-server/accepted": `sha256:${"c".repeat(64)}`,
    };
    expect(publicationImageDigests(JSON.stringify(originals))).toEqual(
      originals,
    );
    expect(publicationImageDigests("{}")).toEqual({});
  });

  test.each([
    "not json",
    JSON.stringify({ unknown: `sha256:${"a".repeat(64)}` }),
    JSON.stringify({
      "shepherdjerred/temporal-worker/workflows/stable": `sha256:${"a".repeat(64)}`,
    }),
    JSON.stringify({ "shepherdjerred/temporal-worker": "latest" }),
  ])("rejects invalid transient producer input %s", (input) => {
    expect(() => publicationImageDigests(input)).toThrow();
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
