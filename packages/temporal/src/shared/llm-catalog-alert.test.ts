import { describe, expect, test } from "bun:test";
import {
  buildCatalogWithheldAlert,
  LLM_CATALOG_WITHHELD_ALERT_TTL_MS,
} from "#shared/llm-catalog-alert.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const PR_URL = "https://github.com/shepherdjerred/monorepo/pull/9999";

describe("buildCatalogWithheldAlert", () => {
  test("identifies the alert without per-model labels", () => {
    const alert = buildCatalogWithheldAlert(
      {
        applied: [],
        withheld: ["  claude-opus-5.input: 5 -> 12 is a 140% change"],
        prUrl: undefined,
      },
      NOW,
    );
    expect(alert.labels).toEqual({
      alertname: "LlmCatalogDriftWithheld",
      severity: "warning",
      component: "llm-catalog-refresh",
    });
  });

  test("carries every withheld line into the description", () => {
    const alert = buildCatalogWithheldAlert(
      {
        applied: [],
        withheld: ["  a.input: reason one", "  b.output: two"],
        prUrl: undefined,
      },
      NOW,
    );
    expect(alert.annotations["description"]).toContain("a.input: reason one");
    expect(alert.annotations["description"]).toContain("b.output: two");
    // The Alerts template reads either key depending on the source.
    expect(alert.annotations["message"]).toBe(alert.annotations["description"]);
    expect(alert.annotations["summary"]).toContain("2 upstream edit(s)");
  });

  test("asks the operator to adjudicate rather than to apply", () => {
    // A withheld value is not always a correction. The catalog deliberately
    // holds claude-sonnet-5 at the standard $3/$15 while upstreams list the
    // introductory $2/$10, so the guard fires every week on an intended
    // divergence. Telling the operator to apply upstream would undo it.
    const alert = buildCatalogWithheldAlert(
      {
        applied: [],
        withheld: ["  claude-sonnet-5.input: 3 -> 2 is a 33% change"],
        prUrl: undefined,
      },
      NOW,
    );
    const description = alert.annotations["description"] ?? "";
    expect(description).toContain("apply the upstream value");
    expect(description).toContain(
      "confirm the catalog's value is the intended",
    );
    expect(description).not.toContain("apply it by hand");
  });

  test("says nothing was published when no PR was opened", () => {
    const alert = buildCatalogWithheldAlert(
      { applied: [], withheld: ["  a.input: reason"], prUrl: undefined },
      NOW,
    );
    expect(alert.annotations["description"]).toContain(
      "opened no catalog PR, so these withheld lines are its only outcome",
    );
  });

  test("a mixed run links the PR that carries the applied edits", () => {
    // Applied edits are written to the catalog, which opens a refresh PR. An
    // alert that still said "no PR exists to review" would send the operator
    // away from the actual review artifact.
    const alert = buildCatalogWithheldAlert(
      {
        applied: [
          "  gpt-5.6-terra.input: 2.5 -> 2",
          "  gpt-5.5.ctx: 4e5 -> 1e6",
        ],
        withheld: ["  claude-sonnet-5.input: 3 -> 2 is a 33% change"],
        prUrl: PR_URL,
      },
      NOW,
    );
    const description = alert.annotations["description"] ?? "";
    expect(description).toContain("The other 2 edit(s)");
    expect(description).toContain(PR_URL);
    expect(description).not.toContain("opened no catalog PR");
    // The withheld line is still the subject of the alert.
    expect(description).toContain("claude-sonnet-5.input");
    expect(alert.annotations["summary"]).toContain("1 upstream edit(s)");
  });

  test("applied edits alone never conjure a PR reference", () => {
    // The alert is built at each exit with that exit's real `prUrl`. If it
    // inferred a PR from a non-empty `applied` instead, an alert published
    // before — or without — a successful `openSeasonRefreshPr` would spend
    // eight days pointing at a PR that does not exist.
    const alert = buildCatalogWithheldAlert(
      {
        applied: ["  gpt-5.6-terra.input: 2.5 -> 2"],
        withheld: ["  claude-sonnet-5.input: 3 -> 2 is a 33% change"],
        prUrl: undefined,
      },
      NOW,
    );
    const description = alert.annotations["description"] ?? "";
    expect(description).toContain("opened no catalog PR");
    expect(description).not.toContain("review those in");
    expect(description).not.toContain("github.com");
  });

  test("bounds a pathological run and says how much it dropped", () => {
    const alert = buildCatalogWithheldAlert(
      {
        applied: [],
        withheld: Array.from(
          { length: 40 },
          (_, i) => `  model-${String(i)}.input: reason`,
        ),
        prUrl: undefined,
      },
      NOW,
    );
    expect(alert.annotations["description"]).toContain("model-24.input");
    expect(alert.annotations["description"]).not.toContain("model-25.input");
    expect(alert.annotations["description"]).toContain("…and 15 more");
  });

  test("outlives the weekly refresh cadence so it cannot self-resolve between runs", () => {
    const alert = buildCatalogWithheldAlert(
      { applied: [], withheld: ["  a.input: reason"], prUrl: undefined },
      NOW,
    );
    const firingMs = new Date(alert.endsAt).getTime() - NOW.getTime();
    expect(firingMs).toBe(LLM_CATALOG_WITHHELD_ALERT_TTL_MS);
    expect(firingMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
    expect(alert.startsAt).toBe(NOW.toISOString());
  });

  test("an empty withheld set resolves immediately instead of firing", () => {
    // Without this a remediated finding keeps reporting for the full eight-day
    // lifetime, and the next clean weekly run would not shorten it.
    const resolved = buildCatalogWithheldAlert(
      {
        applied: ["  gpt-5.6-terra.input: 2.5 -> 2"],
        withheld: [],
        prUrl: PR_URL,
      },
      NOW,
    );
    expect(resolved.endsAt).toBe(NOW.toISOString());
    expect(resolved.startsAt).toBe(resolved.endsAt);
    expect(resolved.annotations["summary"]).toContain("resolved");
  });

  test("the resolution targets the firing alert's exact label set", () => {
    // Alertmanager identifies an alert by its labels alone, so a single
    // differing label would leave the firing occurrence open forever.
    const firing = buildCatalogWithheldAlert(
      { applied: [], withheld: ["  a.input: reason"], prUrl: undefined },
      NOW,
    );
    expect(
      buildCatalogWithheldAlert(
        { applied: [], withheld: [], prUrl: undefined },
        NOW,
      ).labels,
    ).toEqual(firing.labels);
  });
});
