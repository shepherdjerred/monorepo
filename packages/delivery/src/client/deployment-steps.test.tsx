import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as fixtures from "#testing/model-fixtures.ts";
import type { DeploymentDetail } from "#shared/contract.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { DeploymentRecord } from "./deployment-detail.tsx";
import { DeploymentEvidence, StepTimeline } from "./deployment-steps.tsx";

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
