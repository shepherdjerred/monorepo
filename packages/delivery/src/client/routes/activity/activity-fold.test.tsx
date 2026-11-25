import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "#shared/hub/hub-contract.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { foldActivity, latestStages, outcomeOf } from "./activity-fold.ts";
import { ResultSummary } from "#client/routes/list-page.tsx";
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

  it("keeps one row for each deployment, wherever other deployments' writes fall", () => {
    expect(
      shape([
        stage(FIRST, "step-sync", "succeeded"),
        stage(SECOND, "step-sync", "succeeded"),
        stage(FIRST, "step-sync", "running"),
        stage(SECOND, "step-render", "succeeded"),
      ]),
    ).toEqual([
      ["45cf:step-sync", "45cf:step-sync"],
      ["3342:step-sync", "3342:step-render"],
    ]);
  });

  it("folds a step's updates into one row across other entries and other actors", () => {
    const rowsOf = foldActivity([
      stage(FIRST, "step-provenance", "succeeded"),
      entry("deployment.lease_renewed", FIRST),
      stage(FIRST, "step-provenance", "running", "operator@example.com"),
      entry("platform.plan_recorded", SECOND),
      stage(FIRST, "step-provenance", "running"),
    ]);
    expect(rowsOf.map((row) => row.kind)).toEqual([
      "stages",
      "repeated",
      "entry",
    ]);
    const [stages] = rowsOf;
    expect(stages?.kind === "stages" ? stages.entries : []).toHaveLength(3);
  });

  it("folds an executor's check-ins on one deployment into one row, however they interleave", () => {
    const rowsOf = foldActivity([
      entry("deployment.lease_renewed", FIRST),
      entry("deployment.lease_renewed", FIRST),
      entry("deployment.claimed", SECOND),
      entry("deployment.lease_renewed", FIRST),
      entry("deployment.lease_renewed", SECOND),
      entry("deployment.lease_renewed", FIRST, {}, "another-executor"),
    ]);
    expect(
      rowsOf.map((row) => (row.kind === "entry" ? 1 : row.entries.length)),
    ).toEqual([3, 1, 1, 1]);
  });

  it("folds Delivery's repeated requests to retire one worker in one environment, not another's", () => {
    const retirement = (
      worker: string,
      environmentId: string,
    ): ActivityEntry => ({
      ...entry(
        "worker.retirement_requested",
        worker,
        {},
        "delivery/auto-retire",
      ),
      subject: { serviceId: "scout-for-lol", environmentId, revision: 338 },
    });
    const rowsOf = foldActivity([
      retirement("scout-beta-w1", "scout-for-lol/beta"),
      entry("deployment.requested", FIRST),
      retirement("scout-beta-w1", "scout-for-lol/beta"),
      retirement("scout-beta-w2", "scout-for-lol/beta"),
      retirement("scout-prod-w1", "scout-for-lol/prod"),
      retirement("scout-beta-w1", "scout-for-lol/beta"),
    ]);
    expect(
      rowsOf.map((row) => (row.kind === "entry" ? 1 : row.entries.length)),
    ).toEqual([3, 1, 1, 1]);
  });

  it("folds the repeats of one worker retirement's proof into one row, not another deployment's", () => {
    const proved = (deployment: string): ActivityEntry => ({
      ...entry("worker.retirement_proved", deployment),
      target: { kind: "deployment", id: deployment },
      subject: {
        serviceId: "temporal",
        environmentId: "temporal/prod",
        revision: 461,
      },
    });
    const rowsOf = foldActivity([
      proved(FIRST),
      proved(FIRST),
      entry("deployment.succeeded", FIRST),
      proved(SECOND),
      proved(FIRST),
    ]);
    expect(
      rowsOf.map((row) => (row.kind === "entry" ? 1 : row.entries.length)),
    ).toEqual([3, 1, 1]);
    const [folded = ""] = rows(
      render([proved(FIRST), proved(FIRST), proved(FIRST)]),
    );
    expect(folded).toContain("Worker retired");
    expect(folded).toContain("×3");
    expect(folded).toContain("3 proofs");
    expect(folded).toContain(`href="/deployments/${FIRST}"`);
    expect(folded).toContain("temporal/prod");
  });

  it("still ends a run of repeated build records at another action or actor", () => {
    expect(
      foldActivity([
        entry("build.verified", "build-1"),
        entry("build.verified", "build-2"),
        entry("build.verified", "build-3", {}, "ci"),
        entry("build.published", "build-3"),
        entry("build.verified", "build-4"),
      ]).map((row) => (row.kind === "entry" ? 1 : row.entries.length)),
    ).toEqual([2, 1, 1, 1]);
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
      /step-apply-safety<\/span><span class="status status-succeeded" data-sev="ok">.*2 updates/u,
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
    expect(silent).toContain(
      '<span class="activity-reason muted">No cause was recorded</span>',
    );
  });

  it("says why a build failed CI, or that no reason was recorded", () => {
    const [reasoned = "", unreasoned = "", incompatible = "", other = ""] =
      rows(
        render([
          {
            ...entry("build.failed", "build-1"),
            reason: "Required checks did not pass",
          },
          { ...entry("build.failed", "build-2"), reason: null },
          {
            ...entry("build.incompatible", "build-3"),
            reason: "component server is not in the catalog",
          },
          entry("build.published", "build-4"),
        ]),
      );
    expect(reasoned).toContain(
      '<span class="activity-reason">Required checks did not pass</span>',
    );
    expect(reasoned).toContain("Build failed CI");
    expect(unreasoned).toContain("No cause was recorded");
    expect(incompatible).toContain("component server is not in the catalog");
    expect(other).not.toContain("activity-reason");
  });

  it("shows a worker recovery's recorded reason, or that no cause was recorded", () => {
    const [reasoned = "", silent = ""] = rows(
      render([
        {
          ...entry("worker.recovery_failed", FIRST),
          reason: "The pool read back a different build",
        },
        { ...entry("worker.recovery_failed", SECOND), reason: null },
      ]),
    );
    expect(reasoned).toContain("Worker recovery failed");
    expect(reasoned).toContain(
      '<span class="activity-reason">The pool read back a different build</span>',
    );
    expect(silent).toContain(
      '<span class="activity-reason muted">No cause was recorded</span>',
    );
  });

  it("folds repeats into one row with their count and where they ran", () => {
    const subject = {
      serviceId: "temporal",
      environmentId: "temporal/prod",
      revision: 438,
    };
    const requested = (offset: number): ActivityEntry => ({
      ...entry("worker.retirement_requested", "temporal-w1", {}, "delivery"),
      subject,
      occurredAt: new Date(Date.UTC(2026, 10, 20, 9, 0) - offset).toISOString(),
    });
    const [run = ""] = rows(
      render([requested(0), requested(300_000), requested(600_000)]),
    );
    expect(rows(render([requested(0), requested(300_000)]))).toHaveLength(1);
    expect(run).toContain("Worker retirement requested");
    expect(run).toContain("×3");
    expect(run).toContain("3 requests");
    // Where it happened, and the range the repeats span.
    expect(run).toContain("temporal/prod");
    expect(run).toContain("from ");
    const [checkIns = ""] = rows(
      render([
        entry("deployment.lease_renewed", FIRST),
        entry("deployment.lease_renewed", FIRST),
        entry("deployment.lease_renewed", FIRST),
      ]),
    );
    expect(checkIns).toContain("Executor checked in");
    expect(checkIns).toContain("3 check-ins");
  });

  it("links the deployment a worker's retirement was proved for, as its neighbours do", () => {
    const [retired = ""] = rows(
      render([
        {
          ...entry("worker.retirement_proved", FIRST),
          target: { kind: "deployment", id: FIRST },
        },
      ]),
    );
    expect(retired).toContain("Worker retired");
    expect(retired).toContain(`href="/deployments/${FIRST}"`);
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

  it("lets two writes recorded in the same instant settle on the further stage", () => {
    const at = "2026-11-20T09:00:00.000Z";
    const running = {
      ...stage(FIRST, "step-provenance", "running"),
      occurredAt: at,
    };
    const succeeded = {
      ...stage(FIRST, "step-provenance", "succeeded"),
      occurredAt: at,
    };
    for (const entries of [
      [running, succeeded],
      [succeeded, running],
    ])
      expect(
        latestStages(entries).map(({ status, writes }) => [status, writes]),
      ).toEqual([["succeeded", 2]]);
    // Writes at different times keep the newest, which is the first fetched.
    expect(
      latestStages([
        stage(FIRST, "step-provenance", "running"),
        stage(FIRST, "step-provenance", "succeeded"),
      ]).map(({ status }) => status),
    ).toEqual(["running"]);
  });
});

/** The activity page's result line for `count` rows folded from `events` events. */
function summary(count: number, events: number, more = false) {
  return renderWithRouter(
    <ResultSummary
      count={count}
      noun={count === events ? ["event", "events"] : ["row", "rows"]}
      entries={{
        count: events,
        noun: ["event", "events"],
        folded: "steps and repeats folded",
      }}
      filtered={false}
      older={false}
      more={more}
      problems={[]}
      clearTo="/activity"
    />,
  );
}

describe("the activity result line", () => {
  it("counts the rows it shows, and the events they fold when that differs", () => {
    expect(summary(21, 25)).toContain(
      "Showing all 21 rows (25 events, steps and repeats folded). Newest first.",
    );
    expect(summary(25, 25)).toContain("Showing all 25 events.");
    expect(summary(20, 25, true)).toContain(
      "Showing 20 rows (25 events, steps and repeats folded). Newest first. Older ones are on the next page.",
    );
  });
});
