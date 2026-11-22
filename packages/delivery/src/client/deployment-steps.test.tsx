import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as fixtures from "#testing/model-fixtures.ts";
import type { DeploymentDetail } from "#shared/contract.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { DeploymentRecord } from "./deployment-detail.tsx";
import {
  DeploymentEvidence,
  StepTimeline,
  interrupted,
  noStepsMessage,
  stepMessage,
  stepEnd,
} from "./deployment-steps.tsx";
import {
  WhyItFailed,
  deploymentVerdict,
  failureStory,
  headerStatus,
  offersRetry,
} from "./model/deployment-outcome.tsx";

// The hub client resolves its API origin from the page; static rendering has none.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "location", {
    value: new URL("https://delivery.invalid/"),
    configurable: true,
  });
});

/** Static markup without React's text separators. */
function render(node: ReactNode) {
  return renderWithRouter(
    <QueryClientProvider client={new QueryClient()}>
      {node}
    </QueryClientProvider>,
  ).replaceAll("<!-- -->", "");
}

const [base] = fixtures.deploymentDetails;
if (base === undefined) throw new Error("fixtures hold a deployment detail");
const id = base.deployment.id;
const at = "2026-11-20T08:43:58.160Z";
const PLAN_DIGEST = `sha256:${"7".repeat(64)}`;
const ROLLOUT_PLAN = JSON.stringify({
  adapter: "worker-rollout-plan",
  plan: { target: "scout-prod", namespace: "prod", routes: [{ ramp: 100 }] },
});

function stage(
  key: string,
  status: "running" | "succeeded" | "failed",
  message: string,
): DeploymentDetail["stages"][number] {
  return {
    id: `${id}/${key}`,
    deploymentId: id,
    key,
    status,
    operationId: `delivery-${"9".repeat(40)}`,
    message,
    startedAt: at,
    updatedAt: at,
  };
}

function evidence(
  suffix: string,
  summary: string,
  kind: DeploymentDetail["evidence"][number]["kind"] = "runtime",
): DeploymentDetail["evidence"][number] {
  return {
    id: `${id}/${suffix}`,
    deploymentId: id,
    kind,
    summary,
    createdAt: at,
  };
}

const detail: DeploymentDetail = {
  ...base,
  stages: [
    stage("step-plan", "succeeded", "plan completed"),
    stage(
      "step-native",
      "succeeded",
      JSON.stringify({ namespace: "delivery-platform-jobs", name: "job-1" }),
    ),
    stage("step-sync", "failed", "ArgoCD sync operation 42 failed"),
    stage("step-sync/drain", "running", ""),
    stage("step-render", "succeeded", "render completed"),
  ],
  evidence: [
    evidence(
      "stage/step-plan/0",
      JSON.stringify({
        adapter: "tofu",
        step: "plan",
        planDigest: PLAN_DIGEST,
        changes: { create: 2, update: 1, delete: 0, replace: 0 },
      }),
      "preflight",
    ),
    evidence("stage/step-plan/1", ROLLOUT_PLAN, "preflight"),
    evidence("stage/step-sync/0", "Application left Degraded"),
    evidence("stage/step-sync/drain/0", "No retained build was drained"),
    evidence("stage/step-gone/0", "Recorded by a step no longer listed"),
    evidence("finish/0", "No later step started", "reconciliation"),
    evidence(`monitor/alarms/${"a".repeat(64)}`, "ScoutAlarm fired", "alarm"),
    evidence(
      "recovery/argo/beta/recovery/0",
      "Operation 7 settled",
      "preflight",
    ),
    {
      ...evidence("x", "An older row with its own id shape"),
      id: "evidence/scout-prod-42/alarm",
    },
  ],
};

/** Each top-level step of the rendered timeline. */
function steps(html: string) {
  return html.split('<li class="step ').slice(1);
}

function step(html: string, key: string) {
  const found = steps(html).find((entry) =>
    entry.includes(`<strong class="step-key">${key}</strong>`),
  );
  if (found === undefined) throw new Error(`no step ${key}`);
  return found;
}

describe("the step timeline", () => {
  const html = render(<StepTimeline detail={detail} />);

  it("lists every step with its status and its operation id in short form", () => {
    expect(steps(html)).toHaveLength(5);
    expect(step(html, "step-sync")).toContain("status-failed");
    expect(step(html, "step-plan")).toContain(
      `title="delivery-${"9".repeat(40)}"`,
    );
    expect(step(html, "step-plan")).toContain("delivery-999…");
  });

  it("nests each step's own evidence beneath it, with a count", () => {
    const plan = step(html, "step-plan");
    expect(plan).toContain('<span class="disclosure-count">2</span>');
    expect(plan).toContain("tofu");
    expect(plan).not.toContain("Application left Degraded");
    expect(step(html, "step-sync")).toContain("Application left Degraded");
    // A sub-stage keeps its evidence; its parent does not show it.
    expect(step(html, "step-sync")).not.toContain("No retained build");
    expect(step(html, "step-sync/drain")).toContain("No retained build");
  });

  it("folds a succeeded step's evidence and opens a failed or running one", () => {
    expect(step(html, "step-plan")).toContain('<details class="disclosure">');
    expect(step(html, "step-sync")).toContain(
      '<details class="disclosure" open="">',
    );
    expect(step(html, "step-sync/drain")).toContain(
      '<details class="disclosure" open="">',
    );
  });

  it("says when a step recorded nothing", () => {
    const rendered = step(html, "step-render");
    expect(rendered).toContain("no evidence");
    expect(rendered).not.toContain("<details");
  });

  it("renders a JSON summary as labelled facts, never as raw JSON", () => {
    const plan = step(html, "step-plan");
    expect(plan).toContain('<strong class="evidence-adapter">tofu</strong>');
    expect(plan).toContain("<dt>Plan digest</dt>");
    expect(plan).toContain(`title="${PLAN_DIGEST}"`);
    expect(plan).toContain("<dt>Changes</dt>");
    expect(plan).toContain("create 2 · update 1 · delete 0 · replace 0");
    expect(html).not.toContain("{&quot;adapter&quot;");
    expect(html).not.toContain('{"adapter"');
  });

  it("keeps a nested value as formatted JSON inside a closed disclosure", () => {
    const plan = step(html, "step-plan");
    expect(plan).toContain(
      '<strong class="evidence-adapter">worker-rollout-plan</strong>',
    );
    expect(plan).toMatch(
      /<details class="disclosure"><summary><span class="disclosure-label">Plan<\/span><\/summary>.*<pre class="receipt-json"><code>\{\n {2}&quot;target&quot;: &quot;scout-prod&quot;/su,
    );
  });

  it("renders a step message that is JSON as facts inside the step", () => {
    const native = step(html, "step-native");
    expect(native).toContain("Step message");
    expect(native).toContain("<dt>Namespace</dt>");
    expect(native).toContain("delivery-platform-jobs");
    expect(native).not.toContain("&quot;namespace&quot;");
    expect(step(html, "step-plan")).toContain(
      '<p class="step-message">plan completed</p>',
    );
  });

  it("says so when no stage has started", () => {
    expect(render(<StepTimeline detail={{ ...detail, stages: [] }} />)).toBe(
      '<p class="empty">No stages have started.</p>',
    );
  });
});

describe("the evidence no listed step recorded", () => {
  const html = render(<DeploymentEvidence detail={detail} />);

  it("groups it under what recorded it", () => {
    expect(html.match(/<h3>[^<]+<\/h3>/gu)).toEqual([
      "<h3>Reported with the result</h3>",
      "<h3>Monitor</h3>",
      "<h3>Recovery</h3>",
      "<h3>Steps not listed</h3>",
      "<h3>Other evidence</h3>",
    ]);
    expect(html).toContain("No later step started");
    expect(html).toContain("ScoutAlarm fired");
  });

  it("links recovery evidence to its intent", () => {
    expect(html).toContain('href="/recovery-intents/argo/beta/recovery"');
    expect(html).toContain("Operation 7 settled");
  });

  it("keeps evidence of an unlisted step and of an unknown id shape", () => {
    expect(html).toContain("step step-gone");
    expect(html).toContain("Recorded by a step no longer listed");
    expect(html).toContain("An older row with its own id shape");
    expect(html).toContain('title="evidence/scout-prod-42/alarm"');
  });

  it("points at the steps for the evidence shown under them", () => {
    expect(html).toContain(
      "4 more are shown under the steps that recorded them.",
    );
    expect(html).not.toContain("Application left Degraded");
    expect(
      render(
        <DeploymentEvidence
          detail={{ ...detail, evidence: detail.evidence.slice(0, 2) }}
        />,
      ),
    ).toBe(
      '<p class="muted">All 2 pieces of evidence are shown under the steps that recorded them.</p>',
    );
  });

  it("folds a long group past its first five", () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      evidence(`finish/${String(index)}`, `finish evidence ${String(index)}`),
    );
    const rendered = render(
      <DeploymentEvidence detail={{ ...detail, evidence: many }} />,
    );
    const [visible = "", folded = ""] = rendered.split("<details");
    expect(visible).toContain("finish evidence 4");
    expect(visible).not.toContain("finish evidence 5");
    expect(folded).toContain('<span class="disclosure-count">3</span>');
    expect(folded).toContain("finish evidence 7");
  });

  it("says so when nothing was recorded", () => {
    expect(
      render(<DeploymentEvidence detail={{ ...detail, evidence: [] }} />),
    ).toBe('<p class="empty">No verification evidence recorded.</p>');
  });
});

describe("the deployment record", () => {
  const html = render(
    <DeploymentRecord
      detail={detail}
      principal={fixtures.operator}
      pending={false}
      onRecoveryDecision={vi.fn()}
    />,
  );

  it("keeps the Steps, Evidence and Frozen inputs regions", () => {
    for (const [heading, title] of [
      ["progress-heading", "Steps"],
      ["evidence-heading", "Evidence"],
      ["inputs-heading", "Frozen inputs"],
    ]) {
      expect(html).toContain(`aria-labelledby="${String(heading)}"`);
      expect(html).toContain(
        `<h2 id="${String(heading)}">${String(title)}</h2>`,
      );
    }
    const stepsRegion = html.slice(
      html.indexOf('aria-labelledby="progress-heading"'),
      html.indexOf('aria-labelledby="evidence-heading"'),
    );
    expect(stepsRegion).toContain("step-plan");
    expect(stepsRegion).toContain("Application left Degraded");
  });

  it("folds the frozen inputs away, pinned JSON included", () => {
    const inputs = html.slice(html.indexOf('aria-labelledby="inputs-heading"'));
    expect(inputs).toContain(base.pipeline.id);
    expect(inputs).toContain("Selected artifacts");
    expect(inputs).toContain("Pinned pipeline and configuration");
    expect(inputs).not.toContain('<details class="disclosure" open');
    expect(inputs).toMatch(
      /Pinned pipeline and configuration<\/span><\/summary>.*<pre class="receipt-json"><code>/su,
    );
  });
});

const finishedAt = "2026-11-20T09:00:00.000Z";
/** The fixture deployment, ended failed while its sync step was still running. */
const ended = {
  ...base,
  deployment: {
    ...base.deployment,
    status: "failed" as const,
    finishedAt,
    message: "The sync outlived the executor; its result is unknown",
  },
  stages: [
    stage("step-plan", "succeeded", "plan completed"),
    stage("step-sync", "running", "ArgoCD sync operation 7 running"),
  ],
  evidence: [
    evidence("stage/step-sync/0", "Application still Progressing"),
    evidence("finish/0", "No acceptance was attempted", "reconciliation"),
  ],
};

describe("a step its deployment outlived", () => {
  const html = render(<StepTimeline detail={ended} />);

  it("reads as interrupted with its outcome unknown, not as running", () => {
    const sync = step(html, "step-sync");
    expect(sync).toMatch(/^step-interrupted"/u);
    expect(sync).toContain("interrupted · outcome unknown");
    expect(sync).not.toContain("status-running");
    expect(step(html, "step-plan")).toContain("status-succeeded");
  });

  it("stops its clock at the deployment's end", () => {
    const [plan, sync] = ended.stages;
    if (plan === undefined || sync === undefined) throw new Error("stages");
    expect(stepEnd(sync, ended.deployment)).toBe(finishedAt);
    expect(stepEnd(plan, ended.deployment)).toBe(plan.updatedAt);
    // While the deployment runs, a running step's clock keeps going.
    expect(stepEnd(sync, base.deployment)).toBeNull();
    expect(interrupted(sync, base.deployment)).toBe(false);
  });

  it("says what an empty step list means for the deployment's state", () => {
    expect(noStepsMessage({ status: "succeeded" })).toBe(
      "No step history was recorded for this deployment.",
    );
    expect(noStepsMessage({ status: "failed" })).toBe(
      "The deployment ended before any step started.",
    );
    expect(noStepsMessage({ status: "queued" })).toBe(
      "No stages have started.",
    );
  });
});

function record(value: DeploymentDetail) {
  return render(
    <DeploymentRecord
      detail={value}
      principal={fixtures.operator}
      pending={false}
      onRecoveryDecision={vi.fn()}
    />,
  );
}

/** The ended deployment once its recovery intent settled, having read back `readbacks`. */
function settledDetail(
  stages: DeploymentDetail["stages"],
  readbacks: string[],
) {
  return {
    ...ended,
    deployment: {
      ...ended.deployment,
      message:
        "External operation may still be active; inspect its recorded identity before releasing ownership",
    },
    stages,
    evidence: [],
    recoveryIntents: [
      {
        id: "argo/auto-flags",
        kind: "argo" as const,
        deploymentId: id,
        sequence: 1,
        step: null,
        requestedBy: "delivery/auto-recovery",
        reason: "Opened automatically: the deployment ended recovery-required",
        expectedGeneration: 0,
        fingerprint: `sha256:${"4".repeat(64)}`,
        evidence: readbacks.map((summary) => ({
          kind: "reconciliation" as const,
          summary,
        })),
        outcome: "succeeded" as const,
        createdAt: finishedAt,
        settledAt: finishedAt,
      },
    ],
  };
}

describe("why a deployment failed", () => {
  it("names the message, the interrupted step, its last evidence and what to do", () => {
    expect(failureStory(ended)).toMatchObject({
      heading: "Why it failed",
      message: "The sync outlived the executor; its result is unknown",
      step: {
        key: "step-sync",
        outcome: "interrupted",
        message: "ArgoCD sync operation 7 running",
      },
      evidence: { from: "step-sync", text: "Application still Progressing" },
      locked: false,
      next: "retry",
    });
    const html = render(<WhyItFailed detail={ended} />);
    expect(html).toContain('<h2 id="failure-heading">Why it failed</h2>');
    expect(html).toContain(
      "was still running when the deployment ended, so its outcome is unknown",
    );
    expect(html).toContain("Last evidence from step-sync");
    expect(html).toContain('href="/environments/scout-for-lol/prod"');
  });

  it("explains a recovery lock in plain words and links its recovery intent", () => {
    const locked = fixtures.deploymentDetails.find(
      (entry) => entry.deployment.recoveryRequired,
    );
    if (locked === undefined) throw new Error("fixture has a quarantine");
    const story = failureStory(locked);
    expect(story).toMatchObject({
      locked: true,
      next: "recover",
      intent: { id: "scout-prod-37/recovery/2", sequence: 2 },
    });
    const html = render(<WhyItFailed detail={locked} />);
    expect(html).toContain(
      "A change may still be running outside Delivery. It must be checked before this environment unlocks.",
    );
    expect(html).toContain('href="/recovery-intents/scout-prod-37/recovery/2"');
    expect(html).toContain("Recovery intent 2</a> is pending");
  });

  it("reports what a settled recovery read back, not the executor's stale headline", () => {
    const settled = settledDetail(
      [stage("step-sync", "running", "step-sync: running")],
      [
        "Independent Application readback: flags, operation 2a71, phase Failed, finished 2026-11-22T03:27:16Z",
      ],
    );
    const story = failureStory(settled);
    expect(story).toMatchObject({
      message: null,
      settled: {
        sequence: 1,
        readbacks: [{ application: "flags", phase: "Failed" }],
      },
      step: { key: "step-sync", outcome: "interrupted", message: null },
    });
    const html = render(<WhyItFailed detail={settled} />);
    expect(html).not.toContain("may still be active");
    expect(html).not.toContain("outcome is unknown");
    expect(html).toContain(
      "read the external operation back after the deployment ended: it ended in phase Failed.",
    );
    expect(html).toContain('href="/recovery-intents/argo/auto-flags"');
    // The timeline drops the stale running line and reports the reading.
    const timeline = render(<StepTimeline detail={settled} />);
    expect(timeline).not.toContain("step-sync: running");
    expect(timeline).toContain("interrupted · recovery read back phase Failed");
    expect(timeline).not.toContain("outcome unknown");
  });

  it("gives each interrupted step the readback of its own request, and names every Application", () => {
    const first = {
      ...stage("step-sync-web", "running", ""),
      operationId: "request-web",
    };
    const second = {
      ...stage("step-sync-api", "running", ""),
      operationId: "request-api",
    };
    const settled = settledDetail(
      [first, second],
      [
        "Independent Application readback: web, resourceVersion 1, request request-web, operation 1, phase Succeeded, finished 2026-11-22T03:27:16Z",
        "Independent Application readback: api, resourceVersion 2, request request-api, operation 2, phase Failed, finished 2026-11-22T03:27:16Z",
      ],
    );
    const timeline = render(<StepTimeline detail={settled} />);
    expect(step(timeline, "step-sync-web")).toContain(
      "interrupted · recovery read back phase Succeeded",
    );
    expect(step(timeline, "step-sync-api")).toContain(
      "interrupted · recovery read back phase Failed",
    );
    const html = render(<WhyItFailed detail={settled} />);
    expect(html).toContain(
      "read each external operation back after the deployment ended: web ended in phase Succeeded; api ended in phase Failed.",
    );
    // A step no readback answers for does not borrow another's phase.
    const unmatched = settledDetail(
      [{ ...stage("step-sync-db", "running", ""), operationId: "request-db" }],
      settled.recoveryIntents[0]?.evidence.map((entry) => entry.summary) ?? [],
    );
    expect(render(<StepTimeline detail={unmatched} />)).toContain(
      "interrupted · settled by recovery intent 1",
    );
  });

  it("points at the Job a failure names and says each instruction once", () => {
    const job = {
      ...ended,
      deployment: {
        ...ended.deployment,
        message:
          "Deployment stopped; inspect Workflow history and recorded evidence",
      },
      stages: [
        stage(
          "worker-image-provenance",
          "failed",
          "worker-image-provenance: read-only Job failed; nothing changed",
        ),
      ],
      evidence: [
        evidence(
          "stage/worker-image-provenance/0",
          "Pinned Job delivery-worker-jobs/delivery-eab307de, UID 6eb352d6-fa9d-4358-b4f7-dd85a47abc54, fingerprint eab3",
          "preflight",
        ),
        evidence(
          "stage/worker-image-provenance/1",
          "Delivery Job failed; inspect its recorded UID and bounded stage logs; inspect Workflow history and recorded evidence",
          "preflight",
        ),
      ],
    };
    const story = failureStory(job);
    expect(story).toMatchObject({
      message: "Deployment stopped",
      step: { message: "read-only Job failed; nothing changed" },
      evidence: { text: "Delivery Job failed" },
      remedies: [
        "Inspect Workflow history and recorded evidence.",
        "Inspect its recorded UID and bounded stage logs.",
      ],
      pointers: [
        { label: "Job", value: "delivery-worker-jobs/delivery-eab307de" },
        { label: "UID", value: "6eb352d6-fa9d-4358-b4f7-dd85a47abc54" },
      ],
    });
    const html = render(<WhyItFailed detail={job} />);
    expect(html.split("nspect Workflow history")).toHaveLength(2);
    expect(html).toContain(
      '<code class="mono copyable-value">delivery-worker-jobs/delivery-eab307de</code>',
    );
    expect(html).toContain(
      'aria-label="Copy UID 6eb352d6-fa9d-4358-b4f7-dd85a47abc54"',
    );
  });

  it("keeps a step message that says more than its key and status", () => {
    expect(
      stepMessage({
        key: "step-sync",
        status: "running",
        message: "step-sync: running",
      }),
    ).toBeNull();
    expect(
      stepMessage({
        key: "step-sync",
        status: "failed",
        message: "step-sync: Job failed",
      }),
    ).toBe("Job failed");
    expect(
      stepMessage({
        key: "step-plan",
        status: "succeeded",
        message: "plan completed",
      }),
    ).toBe("plan completed");
    expect(
      stepMessage({ key: "step-plan", status: "succeeded", message: "" }),
    ).toBeNull();
  });

  it("says nothing for a deployment that did not fail", () => {
    expect(failureStory(base)).toBeNull();
    expect(render(<WhyItFailed detail={base} />)).toBe("");
  });

  it("the record does not repeat the message the summary or the approval already shows", () => {
    expect(record(ended)).not.toContain("The sync outlived the executor");
    const approved = {
      ...base,
      deployment: { ...base.deployment, message: "Reviewed the release" },
      approval:
        base.approval === null
          ? null
          : { ...base.approval, reason: "Reviewed the release" },
    };
    expect(record(approved)).not.toContain("Reviewed the release");
  });
});

/** Before any fixture deployment was requested. */
const LONG_AGO = "2020-01-01T00:00:00.000Z";

/** Streambot prod r348's readback: the sync it outlived ended Succeeded. */
const SUCCEEDED_READBACK =
  "Independent Application readback: media, resourceVersion 330545892, request 942174ca, operation 6052ec99, phase Succeeded, finished 2026-11-22T08:14:30Z";

/** The ended deployment settled as Succeeded, in an environment at `environment`. */
function recoveredIn(
  environment: Partial<DeploymentDetail["environment"]>,
  acceptedRelease: {
    deploymentId: string;
    revision: number;
    requestedAt: string;
  } | null = null,
) {
  const settled = settledDetail(
    [stage("step-sync", "running", "step-sync: running")],
    [SUCCEEDED_READBACK],
  );
  return {
    ...settled,
    environment: {
      ...settled.environment,
      acceptedDeploymentId: "older-accepted",
      acceptedVersionSetRevisionId: "older-set",
      observedVersionSetRevisionId: "older-set",
      ...environment,
    },
    acceptedRelease,
  };
}

describe("what is true of a failed deployment beyond its status", () => {
  it("says a sync recovery read back as Succeeded was applied but never accepted", () => {
    const applied = recoveredIn(
      { desiredVersionSetRevisionId: ended.deployment.versionSetRevisionId },
      { deploymentId: "older-accepted", revision: 345, requestedAt: LONG_AGO },
    );
    expect(deploymentVerdict(applied)).toEqual({
      kind: "applied",
      acceptedRevision: 345,
    });
    expect(headerStatus(applied)).toEqual({
      value: "unknown",
      label: "failed · applied, not accepted",
    });
    // A retry is how Delivery comes to accept it.
    expect(offersRetry(applied)).toBe(true);
    const html = render(<WhyItFailed detail={applied} />);
    expect(html).toContain("Why it failed");
    expect(html).toContain("it ended in phase Succeeded.");
    expect(html).toContain("change was applied, but Delivery never accepted");
    expect(html).toContain("r345 is still accepted in");
    expect(html).not.toContain("Fix the cause");
    expect(html).not.toContain("may still be active");
  });

  it("calls it recovered once the environment accepts or was seen running that release", () => {
    for (const environment of [
      { acceptedVersionSetRevisionId: ended.deployment.versionSetRevisionId },
      { observedVersionSetRevisionId: ended.deployment.versionSetRevisionId },
      { acceptedDeploymentId: ended.deployment.id },
    ]) {
      const recovered = recoveredIn(environment);
      expect(deploymentVerdict(recovered)).toEqual({ kind: "recovered" });
      expect(headerStatus(recovered)).toEqual({
        value: "succeeded",
        label: "failed, then recovered",
      });
      expect(offersRetry(recovered)).toBe(false);
      const html = render(<WhyItFailed detail={recovered} />);
      expect(html).toContain('<h2 id="failure-heading">How it recovered</h2>');
      expect(html).toContain("Nothing:");
      expect(html).not.toContain("panel-failed");
    }
  });

  it("says a failure a newer acceptance followed is superseded, and offers no retry", () => {
    const superseded = {
      ...ended,
      deployment: { ...ended.deployment, message: "Sync timed out" },
      acceptedRelease: {
        deploymentId: "newer-accepted",
        revision: 9,
        requestedAt: "2026-12-01T00:00:00.000Z",
      },
    };
    expect(deploymentVerdict(superseded)).toEqual({
      kind: "superseded",
      deploymentId: "newer-accepted",
      revision: 9,
    });
    expect(offersRetry(superseded)).toBe(false);
    expect(headerStatus(superseded).label).toBe("failed · superseded by r9");
    const html = render(<WhyItFailed detail={superseded} />);
    expect(html).toContain("Superseded by");
    expect(html).toContain('href="/deployments/newer-accepted"');
    expect(html).toContain("Retry is off");
    expect(html).not.toContain("Fix the cause");
    // An acceptance requested before this deployment does not supersede it.
    expect(
      deploymentVerdict({
        ...superseded,
        acceptedRelease: {
          ...superseded.acceptedRelease,
          requestedAt: LONG_AGO,
        },
      }),
    ).toBeNull();
  });

  it("says no cause was recorded, and where to look, when nothing says why", () => {
    const silent = {
      ...ended,
      deployment: { ...ended.deployment, message: null },
      stages: [],
      evidence: [],
    };
    expect(failureStory(silent)).toMatchObject({ caused: false });
    const html = render(<WhyItFailed detail={silent} />);
    expect(html).toContain("No cause was recorded.");
    expect(html).toContain("Temporal workflow linked above");
    expect(html).not.toContain("Fix the cause");
    expect(render(<WhyItFailed detail={ended} />)).toContain("Fix the cause");
  });
});
