import { describe, expect, test } from "bun:test";
import {
  buildCatalogAlerts,
  buildCatalogWithheldAlert,
  LLM_CATALOG_WITHHELD_ALERT_TTL_MS,
} from "#shared/llm-catalog-alert.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const PR_URL = "https://github.com/shepherdjerred/monorepo/pull/9999";

describe("buildCatalogWithheldAlert", () => {
  test("identifies the occurrence by model, so each resolves on its own", () => {
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
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
      model: "subject-model",
      field: "input",
    });
  });

  test("carries every withheld line into the description", () => {
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
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
    expect(alert.annotations["summary"]).toContain(
      "2 withheld upstream edit(s)",
    );
  });

  test("asks the operator to adjudicate rather than to apply", () => {
    // A withheld value is not always a correction. The catalog deliberately
    // holds claude-sonnet-5 at the standard $3/$15 while upstreams list the
    // introductory $2/$10, so the guard fires every week on an intended
    // divergence. Telling the operator to apply upstream would undo it.
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
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
      {
        model: "subject-model",
        field: "input",
        applied: [],
        withheld: ["  a.input: reason"],
        prUrl: undefined,
      },
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
        model: "subject-model",
        field: "input",
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
    expect(alert.annotations["summary"]).toContain(
      "1 withheld upstream edit(s)",
    );
  });

  test("applied edits alone never conjure a PR reference", () => {
    // The alert is built at each exit with that exit's real `prUrl`. If it
    // inferred a PR from a non-empty `applied` instead, an alert published
    // before — or without — a successful `openSeasonRefreshPr` would spend
    // eight days pointing at a PR that does not exist.
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
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

  test("outlives the weekly refresh cadence so it cannot self-resolve between runs", () => {
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
        applied: [],
        withheld: ["  a.input: reason"],
        prUrl: undefined,
      },
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
        model: "subject-model",
        field: "input",
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
      {
        model: "subject-model",
        field: "input",
        applied: [],
        withheld: ["  a.input: reason"],
        prUrl: undefined,
      },
      NOW,
    );
    expect(
      buildCatalogWithheldAlert(
        {
          model: "subject-model",
          field: "input",
          applied: [],
          withheld: [],
          prUrl: undefined,
        },
        NOW,
      ).labels,
    ).toEqual(firing.labels);
  });
});

describe("withheld-line truncation", () => {
  const manyWithheld = Array.from(
    { length: 40 },
    (_, i) => `  model-${String(i)}.input: reason`,
  );

  test("bounds a pathological run when the PR body holds the full list", () => {
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
        applied: ["  a.input: applied"],
        withheld: manyWithheld,
        prUrl: PR_URL,
      },
      NOW,
    );
    expect(alert.annotations["description"]).toContain("model-24.input");
    expect(alert.annotations["description"]).not.toContain("model-25.input");
    expect(alert.annotations["description"]).toContain("…and 15 more");
    expect(alert.annotations["description"]).toContain("in the PR body");
  });

  test("never truncates when the alert is the only record", () => {
    // A withheld-only run opens no PR and its JSON report dies with the bot's
    // temp clone. Truncating here drops edits nothing else records, and the
    // fixed ordering means the same tail vanishes every week.
    const alert = buildCatalogWithheldAlert(
      {
        model: "subject-model",
        field: "input",
        applied: [],
        withheld: manyWithheld,
        prUrl: undefined,
      },
      NOW,
    );
    const description = alert.annotations["description"] ?? "";
    for (const line of manyWithheld) {
      expect(description).toContain(line.trim());
    }
    expect(description).not.toContain("more —");
  });
});

/** Firing (not resolving) occurrences of one alertname, as "model.field". */
function firingFor(
  alerts: ReturnType<typeof buildCatalogAlerts>,
  alertname: string,
): string[] {
  return alerts
    .filter(
      (alert) =>
        alert.labels["alertname"] === alertname &&
        alert.endsAt !== alert.startsAt,
    )
    .map(
      (alert) =>
        `${String(alert.labels["model"])}.${String(alert.labels["field"])}`,
    );
}

describe("buildCatalogAlerts", () => {
  test("a partial upstream row only speaks for the fields it supplied", () => {
    // models.dev can carry `cost.input` while omitting `cost.output`. Marking
    // the whole model measured let an empty-withheld run resolve the output
    // alert on evidence that was never fetched.
    const alerts = buildCatalogAlerts(
      {
        applied: [],
        models: {
          "claude-sonnet-5": {
            withheld: {},
            measured: ["input"],
            unmeasured: ["output"],
          },
        },
        prUrl: undefined,
      },
      NOW,
    );

    // The measured field resolves its drift alert; the unmeasured one gets no
    // drift occurrence at all, so nothing claims output is fine.
    expect(firingFor(alerts, "LlmCatalogDriftWithheld")).toEqual([]);
    expect(
      alerts.some(
        (alert) =>
          alert.labels["alertname"] === "LlmCatalogDriftWithheld" &&
          alert.labels["field"] === "output",
      ),
    ).toBe(false);
    // ...and the gap is stated out loud rather than left as silence.
    expect(firingFor(alerts, "LlmCatalogEvidenceMissing")).toEqual([
      "claude-sonnet-5.output",
    ]);
  });

  test("an unmeasured field neither speaks for others nor expires quietly", () => {
    // Two regressions in one: a run-wide gate let one unmeasurable model freeze
    // every unrelated resolution, and per-model omission alone let a stale
    // drift alert lapse on its TTL with nobody adjudicating it.
    const alerts = buildCatalogAlerts(
      {
        applied: [],
        models: {
          "claude-sonnet-5": {
            withheld: { input: "  claude-sonnet-5.input: 3 -> 2" },
            measured: ["input"],
            unmeasured: [],
          },
          "claude-opus-5": {
            withheld: {},
            measured: ["input"],
            unmeasured: [],
          },
          "gpt-new": { withheld: {}, measured: [], unmeasured: ["input"] },
        },
        prUrl: undefined,
      },
      NOW,
    );

    // The real divergence fires; the clean model resolves anyway.
    expect(firingFor(alerts, "LlmCatalogDriftWithheld")).toEqual([
      "claude-sonnet-5.input",
    ]);
    // The unverifiable one keeps a live occurrence instead of silent expiry.
    expect(firingFor(alerts, "LlmCatalogEvidenceMissing")).toEqual([
      "gpt-new.input",
    ]);
  });

  test("a run with no models publishes nothing", () => {
    expect(
      buildCatalogAlerts({ applied: [], models: {}, prUrl: undefined }, NOW),
    ).toEqual([]);
  });
});
