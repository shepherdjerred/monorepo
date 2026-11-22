import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "#shared/hub/hub-contract.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { foldActivity, latestStages, outcomeOf } from "./activity-fold.ts";
import { ResultSummary } from "./list-page.tsx";
import { ActivityList, isFailure } from "./activity-list.tsx";
import { actionLabel } from "./activity-labels.ts";

const FIRST = "45cf1828-0f01-4bcd-8dab-592769df488f";
const SECOND = "3342245c-e1d6-4e4e-99bb-2c542d22b618";

let sequence = 0;
/** One audit row, newest first as the list is fetched. */
function entry(
  action: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
  actor = "executor",
): ActivityEntry {
  sequence += 1;
  return {
    id: `audit-${String(sequence)}`,
    actor,
    action,
    entityId,
    requestId: `request-${String(sequence)}`,
    metadata,
    occurredAt: new Date(
      Date.UTC(2026, 10, 20, 9, 0, 60 - sequence),
    ).toISOString(),
    target: action.startsWith("deployment.")
      ? { kind: "deployment", id: entityId }
      : null,
  };
}

function stage(entityId: string, key: string, status: string, actor?: string) {
  return entry("deployment.stage", entityId, { stage: key, status }, actor);
}

/** The shape of the folded rows: an action, or the stages of one run. */
function shape(entries: ActivityEntry[]) {
  return foldActivity(entries).map((row) =>
    row.kind === "entry"
      ? row.entry.action
      : row.entries.map(
          (item) =>
            `${item.entityId.slice(0, 4)}:${String(item.metadata["stage"])}`,
        ),
  );
}

describe("foldActivity", () => {
  it("folds consecutive stage writes of one deployment into one row", () => {
    expect(
      shape([
        entry("deployment.succeeded", FIRST),
        stage(FIRST, "step-readback", "succeeded"),
        stage(FIRST, "step-sync", "succeeded"),
        stage(FIRST, "step-render", "succeeded"),
        entry("deployment.claimed", FIRST),
      ]),
    ).toEqual([
      "deployment.succeeded",
      ["45cf:step-readback", "45cf:step-sync", "45cf:step-render"],
      "deployment.claimed",
    ]);
  });

  it("keeps a single stage write as a run of one", () => {
    expect(shape([stage(FIRST, "step-sync", "running")])).toEqual([
      ["45cf:step-sync"],
    ]);
  });

  it("ends a run at another deployment, another actor or another action", () => {
    expect(
      shape([
        stage(FIRST, "step-sync", "succeeded"),
        stage(SECOND, "step-sync", "succeeded"),
        stage(SECOND, "step-render", "succeeded", "operator@example.com"),
        entry("platform.plan_recorded", SECOND),
        stage(SECOND, "step-plan", "running"),
      ]),
    ).toEqual([
      ["45cf:step-sync"],
      ["3342:step-sync"],
      ["3342:step-render"],
      "platform.plan_recorded",
      ["3342:step-plan"],
    ]);
  });

  it("folds only what one page holds: a run cut by the page boundary is a row on each page", () => {
    const run = [
      stage(FIRST, "step-readback", "succeeded"),
      stage(FIRST, "step-sync", "succeeded"),
      stage(FIRST, "step-render", "succeeded"),
    ];
    expect(shape(run.slice(0, 2))).toEqual([
      ["45cf:step-readback", "45cf:step-sync"],
    ]);
    expect(shape(run.slice(2))).toEqual([["45cf:step-render"]]);
  });

  it("drops no entry and keeps the fetched order", () => {
    const entries = [
      stage(FIRST, "b", "succeeded"),
      stage(FIRST, "a", "succeeded"),
      entry("build.published", "build-1"),
      stage(SECOND, "a", "running"),
    ];
    expect(
      foldActivity(entries).flatMap((row) =>
        row.kind === "entry"
          ? [row.entry.id]
          : row.entries.map((item) => item.id),
      ),
    ).toEqual(entries.map((item) => item.id));
  });
});

describe("outcomeOf", () => {
  it("reads the result a deployment's closing action names", () => {
    expect(outcomeOf("deployment.succeeded")).toBe("succeeded");
    expect(outcomeOf("deployment.failed")).toBe("failed");
    expect(outcomeOf("deployment.canceled")).toBe("canceled");
    expect(outcomeOf("deployment.stage")).toBeNull();
    expect(outcomeOf("build.failed")).toBeNull();
  });
});

function render(entries: ActivityEntry[]) {
  return renderWithRouter(<ActivityList entries={entries} />).replaceAll(
    "<!-- -->",
    "",
  );
}

/** Each top-level row of the rendered list. */
function rows(html: string) {
  const list = html.slice(html.indexOf('<ol class="activity">'));
  return list.split(/<li>(?=<span class="activity-when">)/u).slice(1);
}

describe("the activity list", () => {
  it("names each stage and what it became, one row per run", () => {
    const html = render([
      stage(FIRST, "step-sync", "failed"),
      stage(FIRST, "step-render", "succeeded"),
      entry("deployment.claimed", FIRST),
    ]);
    // Labelled columns, then one list item per row.
    expect(html).toMatch(
      /^<div class="activity-table"><div class="activity-columns" aria-hidden="true"><span>When<\/span><span>Action<\/span><span>By<\/span><span>About<\/span><\/div><ol class="activity"><li>/u,
    );
    const [run = "", claimed = ""] = rows(html);
    expect(rows(html)).toHaveLength(2);
    expect(run).toContain('<ol class="activity-stages">');
    expect(run.match(/<span class="mono">step-[a-z]+<\/span>/gu)).toEqual([
      '<span class="mono">step-sync</span>',
      '<span class="mono">step-render</span>',
    ]);
    expect(run).toContain("status-failed");
    expect(run).toContain("status-succeeded");
    expect(run).toContain(`href="/deployments/${FIRST}"`);
    // The deployment is named once, by its short id with the full id kept.
    expect(run.split(`title="${FIRST}"`)).toHaveLength(2);
    expect(claimed).toContain("deployment.claimed");
    expect(claimed).not.toContain("activity-stages");
  });

  it("refuses a stage write that carries no stage", () => {
    expect(() => render([entry("deployment.stage", FIRST)])).toThrow();
  });

  it("shows what a request, a decision, a publication and a result recorded", () => {
    const html = render([
      entry("deployment.failed", FIRST),
      entry(
        "deployment.approve",
        FIRST,
        { override: true, decidedAtPlan: true },
        "operator@example.com",
      ),
      entry("deployment.reject", SECOND, {
        override: false,
        decidedAtPlan: false,
      }),
      entry("deployment.requested", FIRST, {
        environmentId: "arcade/prod",
        versionSetRevisionId: SECOND,
        catalogRevision: `sha256:${"b".repeat(64)}`,
        override: ["set revision is not arcade/beta's accepted selection"],
      }),
      entry("build.published", "build-1", {
        serviceId: "arcade",
        sourceRevision: "c".repeat(40),
      }),
    ]);
    const [
      failed = "",
      approved = "",
      rejected = "",
      requested = "",
      published = "",
    ] = rows(html);
    expect(failed).toContain("status-failed");
    expect(approved).toContain("status-granted");
    expect(approved).toContain("Override");
    expect(approved).toContain("at the saved plan");
    expect(rejected).toContain("status-rejected");
    expect(rejected).not.toContain("Override");
    expect(rejected).not.toContain("at the saved plan");
    expect(requested).toContain('href="/environments/arcade/prod"');
    expect(requested).toContain(`href="/versions/${SECOND}"`);
    expect(requested).toContain(
      "set revision is not arcade/beta&#x27;s accepted selection",
    );
    expect(published).toContain("arcade");
    expect(published).toContain("ccccccc");
    expect(published).toContain(`title="${"c".repeat(40)}"`);
  });

  it("shows rows written before a field existed without inventing it", () => {
    const html = render([
      entry("deployment.approve", FIRST),
      entry("deployment.requested", FIRST, { environmentId: "arcade/prod" }),
    ]);
    const [approved = "", requested = ""] = rows(html);
    expect(approved).toContain("status-granted");
    expect(approved).not.toContain("Override");
    expect(requested).toContain("arcade/prod");
    expect(requested).not.toContain("version set");
  });

  it("puts the actor beside the action and names each link by what it opens", () => {
    const [row = ""] = rows(
      render([entry("deployment.claimed", FIRST, {}, "operator@example.com")]),
    );
    expect(row).toMatch(
      /^<span class="activity-when">.*<\/span><span class="activity-action" title="deployment\.claimed">Deployment started<\/span><span class="activity-actor">operator@example\.com<\/span><span class="activity-subject">/u,
    );
    expect(row).toContain(`aria-label="Deployment ${FIRST}"`);
  });

  it("shows each row's clock reading beside its age, so rows order by eye", () => {
    const [row = ""] = rows(render([entry("deployment.claimed", FIRST)]));
    expect(row).toMatch(
      /<span class="activity-when"><time dateTime="[^"]+" title="[^"]+"><span class="clock">[^<]*\d{2}:\d{2}:\d{2}<span aria-hidden="true"> · <\/span><\/span>/u,
    );
  });

  it("names a deployment's environment and release, and a version set by its number", () => {
    const named = (subject: ActivityEntry["subject"], action: string) => ({
      ...entry(action, FIRST),
      subject,
      target:
        action === "versionSet.composed"
          ? ({ kind: "versionSet", id: FIRST } as const)
          : ({ kind: "deployment", id: FIRST } as const),
    });
    const html = renderWithRouter(
      <ActivityList
        entries={[
          named(
            {
              serviceId: "prometheus",
              environmentId: "prometheus/prod",
              revision: 274,
            },
            "deployment.claimed",
          ),
          named(
            { serviceId: "prometheus", environmentId: null, revision: 8 },
            "versionSet.composed",
          ),
          named(null, "deployment.lease_renewed"),
        ]}
        services={[
          {
            id: "prometheus",
            title: "Prometheus stack",
            environments: [{ id: "prometheus/prod", name: "prod" }],
          },
        ]}
      />,
    ).replaceAll("<!-- -->", "");
    const [claimed = "", composed = "", renewed = ""] = rows(html);
    expect(claimed).toContain(
      '<span class="activity-where"><span title="prometheus/prod">Prometheus stack prod</span> · <span class="revision">r274</span></span>',
    );
    expect(composed).toContain(
      `href="/versions/${FIRST}"><span class="revision">r8</span></a>`,
    );
    expect(composed).toContain(
      '<span class="activity-where"><span title="prometheus">Prometheus stack</span></span>',
    );
    expect(renewed).toContain("Executor checked in");
    expect(renewed).not.toContain("activity-where");
  });

  it("folds a burst of verified builds into one counted row that lists each", () => {
    const html = render([
      entry("build.verified", "build-1"),
      entry("build.verified", "build-2"),
      entry("build.verified", "build-3"),
      entry("deployment.claimed", FIRST),
    ]);
    const [builds = "", claimed = ""] = rows(html);
    expect(rows(html)).toHaveLength(2);
    expect(builds).toContain(
      'Build passed CI<span class="activity-count"> ×3</span>',
    );
    expect(builds).toContain('<span class="disclosure-label">3 builds</span>');
    for (const id of ["build-1", "build-2", "build-3"])
      expect(builds).toContain(`<span class="mono">${id}</span>`);
    expect(claimed).toContain("Deployment started");
  });

  it("marks failures through the failed status, once", () => {
    for (const action of [
      "deployment.failed",
      "worker.recovery_failed",
      "deployment.recovery_required",
    ]) {
      const [row = ""] = rows(render([entry(action, FIRST)]));
      expect(row.split("status-failed")).toHaveLength(2);
      expect(row).toContain(
        `<span class="status-label">${actionLabel(action)}</span>`,
      );
      expect(row).toContain(`title="${action}"`);
    }
    const [plain = ""] = rows(render([entry("deployment.claimed", FIRST)]));
    expect(plain).not.toContain("status-failed");
    expect(isFailure("build.published")).toBe(false);
    expect(isFailure("platform.recovery_failed")).toBe(true);
  });

  it("says so when there is no activity", () => {
    expect(render([])).toBe('<p class="empty">No activity yet.</p>');
  });
});

describe("what an activity row says", () => {
  it("lists each stage of a run once, at its newest state", () => {
    const [run = ""] = rows(
      render([
        stage(FIRST, "step-sync", "running"),
        stage(FIRST, "step-apply-safety", "succeeded"),
        stage(FIRST, "step-apply-safety", "running"),
      ]),
    );
    expect(run.match(/>step-apply-safety</gu)).toHaveLength(1);
    expect(run).toMatch(
      /step-apply-safety<\/span><span class="status status-succeeded">.*2 updates/u,
    );
    expect(run).toContain(">step-sync<");
  });

  it("says why a deployment failed when the list read its message", () => {
    const [failed = ""] = rows(
      render([
        {
          ...entry("deployment.failed", FIRST),
          reason: "Job delivery-worker-jobs/delivery-1 failed",
        },
      ]),
    );
    expect(failed).toContain(
      '<span class="activity-reason">Job delivery-worker-jobs/delivery-1 failed</span>',
    );
    const [silent = ""] = rows(
      render([{ ...entry("deployment.failed", FIRST), reason: null }]),
    );
    expect(silent).not.toContain("activity-reason");
  });
});

describe("latestStages", () => {
  it("folds a stage's lifecycle into its newest write, keeping the fetched order", () => {
    expect(
      latestStages([
        stage(FIRST, "step-sync", "running"),
        stage(FIRST, "step-apply-safety", "succeeded"),
        stage(FIRST, "step-apply-safety", "running"),
        stage(FIRST, "step-render", "succeeded"),
      ]).map(({ stage: key, status, writes }) => [key, status, writes]),
    ).toEqual([
      ["step-sync", "running", 1],
      ["step-apply-safety", "succeeded", 2],
      ["step-render", "succeeded", 1],
    ]);
  });
});

/** The activity page's result line for `count` rows folded from `entries` entries. */
function summary(count: number, entries: number) {
  return renderWithRouter(
    <ResultSummary
      count={count}
      noun={count === entries ? ["entry", "entries"] : ["row", "rows"]}
      entries={{ count: entries, noun: ["entry", "entries"] }}
      filtered={false}
      older={false}
      problems={[]}
      clearTo="/activity"
    />,
  );
}

describe("the activity result line", () => {
  it("counts the rows it shows, and the entries they fold when that differs", () => {
    expect(summary(21, 25)).toContain(
      "Showing 21 rows of 25 entries, newest first.",
    );
    expect(summary(25, 25)).toContain("Showing 25 entries, newest first.");
  });
});
