import { describe, expect, test } from "bun:test";
import {
  buildCatalogWithheldAlert,
  LLM_CATALOG_WITHHELD_ALERT_TTL_MS,
} from "#shared/llm-catalog-alert.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");

describe("buildCatalogWithheldAlert", () => {
  test("identifies the alert without per-model labels", () => {
    const alert = buildCatalogWithheldAlert(
      ["  claude-opus-5.input: 5 -> 12 is a 140% change (models.dev)"],
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
      ["  a.input: reason one", "  b.output: reason two"],
      NOW,
    );
    expect(alert.annotations["description"]).toContain("a.input: reason one");
    expect(alert.annotations["description"]).toContain("b.output: reason two");
    // The Alerts template reads either key depending on the source.
    expect(alert.annotations["message"]).toBe(alert.annotations["description"]);
    expect(alert.annotations["summary"]).toContain("2 upstream edit(s)");
  });

  test("bounds a pathological run and says how much it dropped", () => {
    const alert = buildCatalogWithheldAlert(
      Array.from(
        { length: 40 },
        (_, i) => `  model-${String(i)}.input: reason`,
      ),
      NOW,
    );
    expect(alert.annotations["description"]).toContain("model-24.input");
    expect(alert.annotations["description"]).not.toContain("model-25.input");
    expect(alert.annotations["description"]).toContain("…and 15 more");
  });

  test("outlives the weekly refresh cadence so it cannot self-resolve between runs", () => {
    const alert = buildCatalogWithheldAlert(["  a.input: reason"], NOW);
    const firingMs = new Date(alert.endsAt).getTime() - NOW.getTime();
    expect(firingMs).toBe(LLM_CATALOG_WITHHELD_ALERT_TTL_MS);
    expect(firingMs).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
    expect(alert.startsAt).toBe(NOW.toISOString());
  });

  test("an empty withheld set resolves immediately instead of firing", () => {
    // Without this a remediated finding keeps reporting for the full eight-day
    // lifetime, and the next clean weekly run would not shorten it.
    const resolved = buildCatalogWithheldAlert([], NOW);
    expect(resolved.endsAt).toBe(NOW.toISOString());
    expect(resolved.startsAt).toBe(resolved.endsAt);
    expect(resolved.annotations["summary"]).toContain("resolved");
  });

  test("the resolution targets the firing alert's exact label set", () => {
    // Alertmanager identifies an alert by its labels alone, so a single
    // differing label would leave the firing occurrence open forever.
    const firing = buildCatalogWithheldAlert(["  a.input: reason"], NOW);
    expect(buildCatalogWithheldAlert([], NOW).labels).toEqual(firing.labels);
  });
});
