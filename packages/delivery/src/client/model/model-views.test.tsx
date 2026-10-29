import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as fixtures from "#testing/model-fixtures.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { queries } from "#client/queries.ts";
import { ApprovalQueue } from "./approval-queue.tsx";
import { DeploymentModel } from "./deployment-model.tsx";
import { EnvironmentModel } from "./environment-model.tsx";
import { MonitorPanel } from "./monitor-panel.tsx";
import { PlanApproval } from "./plan-approval.tsx";
import { ReleaseForm } from "#client/release-form.tsx";
import {
  awaitsDecision,
  firingAlarms,
  monitorEvidence,
  rebindChanges,
  retryable,
  specializedRecoveryShown,
} from "./view.ts";

// The hub client resolves its API origin from the page; static rendering has none.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "location", {
    value: new URL("https://delivery.invalid/"),
    configurable: true,
  });
});

/** Static markup without React's text separators. */
function markup(node: ReactNode) {
  return renderWithRouter(node).replaceAll("<!-- -->", "");
}

function render(node: ReactNode, seed?: (client: QueryClient) => void) {
  const client = new QueryClient();
  seed?.(client);
  return markup(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

/** Each `<li>` of the rendered candidate list. */
function candidateItems(html: string) {
  return html.split("<li").slice(1);
}

describe("model view helpers", () => {
  test("reads each evidence count against its threshold", () => {
    expect(monitorEvidence(fixtures.monitors.prod)).toEqual([
      { key: "matches-processed", threshold: 50, value: 12, met: false },
      { key: "discord-interactions", threshold: 20, value: 21, met: true },
    ]);
    expect(monitorEvidence(fixtures.monitors.unmonitored)).toEqual([]);
  });

  test("counts only alarms of the declared severities", () => {
    const status = fixtures.monitors.prod;
    const latest = status.latestObservation;
    if (latest === null) throw new Error("fixture has an observation");
    const info = {
      ...status,
      latestObservation: {
        ...latest,
        alarms: [
          {
            alertname: "ScoutNoisy",
            severity: "info" as const,
            labels: {},
            activeAt: latest.observedAt,
          },
        ],
      },
    };
    expect(
      firingAlarms(status).counted.map((alarm) => alarm.alertname),
    ).toEqual(["ScoutDurableReceiptsStalled"]);
    expect(firingAlarms(info)).toEqual({ counted: [], preExisting: [] });
  });

  test("an alarm already firing before the claim is shown apart and not counted", () => {
    const status = fixtures.monitors.prod;
    const latest = status.latestObservation;
    if (latest === null || status.claimedAt === null)
      throw new Error("fixture has a claimed observation");
    const before = new Date(
      Date.parse(status.claimedAt) - 60_000,
    ).toISOString();
    const old = {
      alertname: "ScoutOldOutage",
      severity: "critical" as const,
      labels: {},
      activeAt: before,
    };
    const split = firingAlarms({
      ...status,
      latestObservation: { ...latest, alarms: [...latest.alarms, old] },
    });
    expect(split.counted.map((alarm) => alarm.alertname)).toEqual([
      "ScoutDurableReceiptsStalled",
    ]);
    expect(split.preExisting).toEqual([old]);
  });

  test("a rebind changes only the coordinates the declared binding moved", () => {
    expect(rebindChanges(fixtures.selections.prod)).toEqual({
      configurationRevisionId: "scout-prod-config/8",
    });
    expect(rebindChanges(fixtures.selections.beta)).toBeNull();
    expect(
      rebindChanges({
        ...fixtures.selections.prod,
        accepted: null,
        acceptedDeploymentId: null,
      }),
    ).toBeNull();
  });

  test("offers a retry for every kind the API retries, once failed or canceled", () => {
    for (const kind of [
      "deploy",
      "promote",
      "rollback",
      "rebind",
      "channel-publish",
      "operator-run",
    ]) {
      expect(retryable({ kind, status: "failed" })).toBe(true);
      expect(retryable({ kind, status: "canceled" })).toBe(true);
      expect(retryable({ kind, status: "succeeded" })).toBe(false);
    }
    for (const kind of ["retire-host", "adopt-worker", "tofu-apply"])
      expect(retryable({ kind, status: "failed" })).toBe(false);
  });

  test("only pending approvals wait for a decision", () => {
    expect(fixtures.approvalQueue.map((item) => awaitsDecision(item))).toEqual([
      true,
      true,
      false,
    ]);
  });
});

function environment(permitted: boolean) {
  return render(
    <EnvironmentModel
      environmentId={fixtures.PROD}
      permitted={permitted}
      onDeployment={() => Promise.resolve()}
    />,
    (client) => {
      client.setQueryData(
        queries.selection(fixtures.PROD).queryKey,
        fixtures.selections.prod,
      );
      client.setQueryData(
        queries.monitor(fixtures.PROD).queryKey,
        fixtures.monitors.prod,
      );
      client.setQueryData(
        queries.rollbackCandidates(fixtures.PROD).queryKey,
        fixtures.rollbackCandidates.prod,
      );
    },
  );
}

describe("environment model panels", () => {
  test("shows the accepted selection beside the declared binding", () => {
    const html = environment(true);
    expect(html).toContain("scout-for-lol:r42");
    expect(html).toContain("scout-prod-config/8");
    expect(html).toContain("differs from accepted");
    expect(html).toContain("Human approval required");
    expect(html).toMatch(/<button[^>]*>Rebind<\/button>/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Rebind</u);
  });

  test("offers eligible candidates and disables excluded ones with their reasons", () => {
    const html = environment(true);
    const items = candidateItems(html.slice(html.indexOf("candidates")));
    expect(items).toHaveLength(4);
    expect(items[0]).not.toContain('disabled=""');
    expect(items[1]).not.toContain('disabled=""');
    expect(items[2]).toContain('disabled=""');
    expect(items[2]).toContain(
      "forwardOnly configuration key MATCH_STORE_SCHEMA",
    );
    expect(items[3]).toContain('disabled=""');
    expect(items[3]).toContain("point of no return");
  });

  test("a read-only identity cannot request a rollback or rebind", () => {
    const html = environment(false);
    expect(html).toContain("Your identity has read-only access.");
    const items = candidateItems(html.slice(html.indexOf("candidates")));
    expect(items.every((item) => item.includes('disabled=""'))).toBe(true);
  });

  test("the monitor shows policy, evidence against threshold and firing alarms", () => {
    const html = markup(<MonitorPanel status={fixtures.monitors.prod} />);
    expect(html).toContain("alarmed");
    expect(html).toContain("Roll back automatically on alarm");
    expect(html).toContain("12 of 50");
    expect(html).toContain("Below threshold");
    expect(html).toContain("ScoutDurableReceiptsStalled");
    expect(html).toContain("window 14m");
    const unmonitored = markup(
      <MonitorPanel status={fixtures.monitors.unmonitored} />,
    );
    expect(unmonitored).toContain("settled on acceptance");
    expect(unmonitored).not.toContain("Firing alarms");
  });
});

describe("deployment model", () => {
  test("shows the frozen, previous and restored selections with the approval", () => {
    const [rollback, alarmed] = fixtures.deploymentDetails;
    if (rollback === undefined || alarmed === undefined)
      throw new Error("fixture details");
    const html = render(<DeploymentModel detail={rollback} />, (client) => {
      client.setQueryData(
        queries.deployment("scout-prod-42").queryKey,
        alarmed,
      );
    });
    expect(html).toContain("scout-for-lol:r41");
    expect(html).toContain("Restores the selection accepted by");
    expect(html).toContain("scout-prod-41");
    expect(html).toContain("Previous accepted selection");
    expect(html).toContain("scout-for-lol:r42");
    expect(html).toContain("granted");
  });

  test("an expired override approval says why it lapsed", () => {
    const expired = fixtures.deploymentDetails.find(
      (detail) => detail.approval?.status === "expired",
    );
    if (expired === undefined) throw new Error("fixture detail");
    const html = render(
      <DeploymentModel
        detail={{
          ...expired,
          approval:
            expired.approval === null
              ? null
              : { ...expired.approval, override: true },
        }}
      />,
    );
    expect(html).toContain("expired");
    expect(html).toContain("binding generation");
    expect(html).toContain("Override");
  });

  test("a quarantined deployment links its unified recovery intents", () => {
    const quarantined = fixtures.deploymentDetails.find(
      (detail) => detail.recoveryIntents.length > 0,
    );
    if (quarantined === undefined) throw new Error("fixture detail");
    const html = render(<DeploymentModel detail={quarantined} />);
    expect(html).toContain("/recovery-intents/scout-prod-37/recovery/1");
    expect(html).toContain("Intent 2");
    expect(html).toContain("pending");
  });

  test("a model Tofu deployment's platform intent stays listed, since no specialized panel shows it", () => {
    const quarantined = fixtures.deploymentDetails.find(
      (detail) => detail.recoveryIntents.length > 0,
    );
    if (quarantined === undefined) throw new Error("fixture detail");
    const platform = {
      ...fixtures.recoveryIntents.pending,
      id: "scout-prod-37/recovery/3",
      kind: "platform" as const,
      sequence: 3,
    };
    // A model Tofu recipe records no legacy platform or control-plane snapshot.
    const detail = {
      ...quarantined,
      deployment: {
        ...quarantined.deployment,
        recoveryRequired: true,
        platformSnapshot: null,
        controlPlaneSnapshot: null,
      },
      recoveryIntents: [platform],
    };
    expect(specializedRecoveryShown(detail, "platform")).toBe(false);
    const html = render(<DeploymentModel detail={detail} />);
    expect(html).toContain("/recovery-intents/scout-prod-37/recovery/3");
    expect(html).not.toContain("No inspection has been requested");
  });
});

describe("approval queue", () => {
  test("separates waiting, override and expired approvals", () => {
    const html = markup(<ApprovalQueue items={fixtures.approvalQueue} />);
    const waiting = html.slice(0, html.indexOf("expired-heading"));
    const expired = html.slice(html.indexOf("expired-heading"));
    expect(waiting).toContain("scout-prod-44");
    expect(waiting).toContain("Override");
    expect(expired).toContain("scout-prod-36");
    expect(expired).toContain("binding generation");
  });

  test("a saved plan waiting on its decision waits in the queue and counts in the badge", () => {
    const [first] = fixtures.approvalQueue;
    if (first === undefined) throw new Error("fixture has a queue item");
    const planned = {
      ...first,
      id: "tofu-cloudflare-prod-3",
      environmentId: "tofu-cloudflare/prod",
      status: "running" as const,
      approval: null,
      awaitingPlanDecision: true,
    };
    expect(awaitsDecision(planned)).toBe(true);
    expect(awaitsDecision({ ...planned, awaitingPlanDecision: false })).toBe(
      false,
    );
    const html = markup(<ApprovalQueue items={[planned]} />);
    const waiting = html.slice(0, html.indexOf("</section>"));
    expect(waiting).toContain("tofu-cloudflare/prod");
    expect(waiting).toContain("Saved plan awaits decision");
  });
});

/** The plan approval control for one detail and principal, as static markup. */
function plan(
  detail: typeof fixtures.planWaiting,
  principal = fixtures.operator,
) {
  return render(<PlanApproval detail={detail} principal={principal} />);
}

describe("plan approval", () => {
  test("shows the waiting saved plan with approve and reject", () => {
    const html = plan(fixtures.planWaiting);
    expect(html).toContain("Plan approval");
    expect(html).toContain(fixtures.savedPlan.planDigest);
    expect(html).toContain("Create 2 · update 1 · delete 0 · replace 0");
    expect(html).toContain("tofu-cloudflare:r7");
    expect(html).toMatch(/<button[^>]*>Approve plan<\/button>/u);
    expect(html).toMatch(/<button[^>]*>Reject plan<\/button>/u);
  });

  test("a reader without approval access sees the plan but cannot approve it", () => {
    const html = plan(fixtures.planWaiting, {
      ...fixtures.operator,
      scopes: ["read"],
    });
    expect(html).toContain(fixtures.savedPlan.planDigest);
    expect(html).toContain("A human with approval access must approve");
    expect(html).not.toContain("Approve plan");
    expect(html).not.toContain("Reject plan");
  });

  test("an approved plan, or a step that is not waiting, shows no control", () => {
    const approved = {
      ...fixtures.planWaiting,
      stages: [
        ...fixtures.planWaiting.stages,
        {
          ...fixtures.attestedStage,
          key: "approve/plan",
          deploymentId: "tofu-cloudflare-prod-7",
        },
      ],
    };
    expect(plan(approved)).toBe("");
    expect(
      plan({
        ...fixtures.planWaiting,
        stages: fixtures.planWaiting.stages.slice(0, 1),
      }),
    ).toBe("");
    expect(plan(fixtures.deploymentDetails[0] ?? fixtures.planWaiting)).toBe(
      "",
    );
  });
});

/** The release form for the beta environment under one release kind. */
function releaseForm(releaseKind: "deploy" | "operator-run") {
  return render(
    <ReleaseForm
      detail={{ ...fixtures.environmentDetails.beta, releaseKind }}
      permitted
      initialKind={undefined}
      onRequested={() => Promise.resolve()}
    />,
  );
}

describe("release form", () => {
  test("requests the kind of the recipe the release freezes, not the declared one", () => {
    // The fixture's declared pipeline is a plain recipe; the server reports
    // that the accepted recipe is operator-run until a rebind.
    const operated = releaseForm("operator-run");
    expect(operated).toContain("Run a version with the operator tool");
    expect(operated).not.toContain("Ask for an override approval");
    const deployed = releaseForm("deploy");
    expect(deployed).toContain("Deploy a version");
    expect(deployed).toContain("Ask for an override approval");
  });
});
