import { describe, expect, test } from "bun:test";
import {
  buildCatalogWithheldAlert,
  LLM_CATALOG_WITHHELD_ALERT_TTL_MS,
} from "#shared/llm-catalog-alert.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");

describe("buildCatalogWithheldAlert", () => {
  test("identifies the alert without per-model labels", () => {
    const alert = buildCatalogWithheldAlert(
      {
        applied: [],
        withheld: ["  claude-opus-5.input: 5 -> 12 is a 140% change"],
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
      { applied: [], withheld: ["  a.input: reason one", "  b.output: two"] },
      NOW,
    );
    expect(alert.annotations["description"]).toContain("a.input: reason one");
    expect(alert.annotations["description"]).toContain("b.output: two");
    // The Alerts template reads either key depending on the source.
    expect(alert.annotations["message"]).toBe(alert.annotations["description"]);
    expect(alert.annotations["summary"]).toContain("2 upstream edit(s)");
  });

  test("only claims nothing changed when nothing was applied", () => {
    const alert = buildCatalogWithheldAlert(
      { applied: [], withheld: ["  a.input: reason"] },
      NOW,
    );
    expect(alert.annotations["description"]).toContain(
      "this run changed nothing and opened no PR",
    );
  });

  test("a mixed run points at the PR instead of denying it exists", () => {
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
      },
      NOW,
    );
    const description = alert.annotations["description"] ?? "";
    expect(description).toContain("The other 2 edit(s)");
    expect(description).toContain("catalog refresh PR");
    expect(description).not.toContain("no PR");
    expect(description).not.toContain("changed nothing");
    // The withheld line is still the subject of the alert.
    expect(description).toContain("claude-sonnet-5.input");
    expect(alert.annotations["summary"]).toContain("1 upstream edit(s)");
  });

  test("bounds a pathological run and says how much it dropped", () => {
    const alert = buildCatalogWithheldAlert(
      {
        applied: [],
        withheld: Array.from(
          { length: 40 },
          (_, i) => `  model-${String(i)}.input: reason`,
        ),
      },
      NOW,
    );
    expect(alert.annotations["description"]).toContain("model-24.input");
    expect(alert.annotations["description"]).not.toContain("model-25.input");
    expect(alert.annotations["description"]).toContain("…and 15 more");
  });

  test("outlives the weekly refresh cadence so it cannot self-resolve between runs", () => {
    const alert = buildCatalogWithheldAlert(
      { applied: [], withheld: ["  a.input: reason"] },
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
      { applied: ["  gpt-5.6-terra.input: 2.5 -> 2"], withheld: [] },
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
      { applied: [], withheld: ["  a.input: reason"] },
      NOW,
    );
    expect(
      buildCatalogWithheldAlert({ applied: [], withheld: [] }, NOW).labels,
    ).toEqual(firing.labels);
  });
});
