import { describe, expect, test } from "vitest";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  publicationImageDigests,
  releaseChartRevisions,
  transitionRendering,
} from "./release-configuration.ts";

// The cutover work merges inert; the window turns transition rendering on with
// a reviewed change to `transitionRendering()` (and this assertion) before the final v1
// root release.
test("transition rendering is off until the cutover window", () => {
  expect(transitionRendering()).toBe(false);
});

// The root renders the data-layer Applications only under transition
// rendering, so the catalog's root inventory must list their charts exactly
// then: turning the switch on also removes their `inactive` exclusions.
test("the catalog activates the data-layer charts with the switch", () => {
  const active = new Set(
    new ServiceIndex().rootReleaseCharts().map((chart) => chart.name),
  );
  for (const name of ["delivery-data", "temporal-data"])
    expect(active.has(name), name).toBe(transitionRendering());
});

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
