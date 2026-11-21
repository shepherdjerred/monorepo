import type { ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as fixtures from "#testing/model-fixtures.ts";
import { PipelineDefinitionSchema } from "#shared/contract.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { queries } from "#client/queries.ts";
import { ConfirmDialogProvider } from "#client/components/confirm-dialog.tsx";
import { ApprovalQueue } from "./approval-queue.tsx";
import { DeploymentModel } from "./deployment-model.tsx";
import { EnvironmentModel } from "./environment-model.tsx";
import { MonitorPanel } from "./monitor-panel.tsx";
import { PlanApproval } from "./plan-approval.tsx";
import { ReleaseForm } from "#client/release-form.tsx";
import { ApprovalForm } from "#client/forms/approval-form.tsx";
import { diffVersionSets } from "#shared/contract.ts";
import {
  environmentBlocker,
  formatEvidence,
  inFlightStatus,
  inFlightWords,
  type Blocker,
} from "./environment-status.ts";
import { EnvironmentNotice, InFlightSummary } from "./environment-notices.tsx";
import {
  awaitsDecision,
  firingAlarms,
  monitorEvidence,
  rebindChanges,
  retryable,
  specializedRecoveryShown,
  splitCandidates,
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

const CLOSED_DIALOG = '<dialog><form method="dialog"></form></dialog>';

/**
 * What a component renders below the page's providers. The page's one
 * confirmation dialog follows it, closed, and no confirm button adds another.
 */
function render(node: ReactNode, seed?: (client: QueryClient) => void) {
  const client = new QueryClient();
  seed?.(client);
  const html = markup(
    <QueryClientProvider client={client}>
      <ConfirmDialogProvider>{node}</ConfirmDialogProvider>
    </QueryClientProvider>,
  );
  expect(html.match(/<dialog/gu)).toHaveLength(1);
  expect(html).toContain(CLOSED_DIALOG);
  return html.replace(CLOSED_DIALOG, "");
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

  test("keeps the first five candidates in sight, and the accepted one wherever it sits", () => {
    const candidates = Array.from({ length: 8 }, (_, index) => ({
      deploymentId: `d${String(index + 1)}`,
    }));
    const split = (accepted: string | null | undefined, count = 8) => {
      const { shown, older } = splitCandidates(
        candidates.slice(0, count),
        accepted,
      );
      return [shown, older].map((list) =>
        list.map((candidate) => candidate.deploymentId).join(" "),
      );
    };
    expect(split("d1")).toEqual(["d1 d2 d3 d4 d5", "d6 d7 d8"]);
    expect(split("d7")).toEqual(["d1 d2 d3 d4 d5 d7", "d6 d8"]);
    // Nothing accepted, or the selection view unavailable: only the first five.
    expect(split(null)).toEqual(["d1 d2 d3 d4 d5", "d6 d7 d8"]);
    expect(split(undefined)).toEqual(["d1 d2 d3 d4 d5", "d6 d7 d8"]);
    expect(split("d1", 5)).toEqual(["d1 d2 d3 d4 d5", ""]);
  });
});

/** The revision numbers the environment page loads: the fixture's version sets. */
const REVISIONS = new Map(
  fixtures.versionSets.map((version) => [version.id, version.revision]),
);

function environment(
  permitted: boolean,
  state: {
    selection?: typeof fixtures.selections.prod;
    candidates?: typeof fixtures.rollbackCandidates.prod;
    blocker?: Blocker;
  } = {},
) {
  return render(
    <EnvironmentModel
      environmentId={fixtures.PROD}
      permitted={permitted}
      revisions={REVISIONS}
      blocker={state.blocker ?? null}
      planWaiting={false}
      onDeployment={() => Promise.resolve()}
    />,
    (client) => {
      client.setQueryData(
        queries.selection(fixtures.PROD).queryKey,
        state.selection ?? fixtures.selections.prod,
      );
      client.setQueryData(
        queries.monitor(fixtures.PROD).queryKey,
        fixtures.monitors.prod,
      );
      client.setQueryData(
        queries.rollbackCandidates(fixtures.PROD).queryKey,
        state.candidates ?? fixtures.rollbackCandidates.prod,
      );
    },
  );
}

/** `count` accepted selections, newest first, as `deployment-1` onwards. */
function manyCandidates(count: number) {
  const [template] = fixtures.rollbackCandidates.prod.candidates;
  if (template === undefined) throw new Error("fixture has a candidate");
  return {
    candidates: Array.from({ length: count }, (_, index) => ({
      ...template,
      deploymentId: `deployment-${String(index + 1)}`,
    })),
  };
}

describe("environment model panels", () => {
  test("shows the accepted selection beside the declared binding", () => {
    const html = environment(true);
    const selection = html.slice(0, html.indexOf("Rollback candidates"));
    // The accepted set revision reads as its number and links to its page.
    expect(selection).toMatch(
      /<a[^>]*href="\/versions\/scout-for-lol%3Ar42"[^>]*><span class="revision">r42<\/span><\/a>/u,
    );
    expect(selection).toContain("Frozen by");
    expect(selection).toContain('href="/deployments/scout-prod-42"');
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
    // Four candidates fit in sight, so nothing is collapsed.
    expect(html).not.toContain("<details");
  });

  test("names a candidate by its revision number, recipe, configuration and deployment", () => {
    const uuid = "45cf1828-0f01-4bcd-8dab-592769df488f";
    const deployment = "0b6b6f0e-52a4-4c0e-9d0c-3f5c0f6f7a11";
    const [known] = fixtures.rollbackCandidates.prod.candidates;
    if (known === undefined) throw new Error("fixture has a candidate");
    const html = environment(true, {
      candidates: {
        candidates: [
          known,
          {
            ...known,
            deploymentId: deployment,
            selection: { ...known.selection, versionSetRevisionId: uuid },
          },
        ],
      },
    });
    const [first, second] = candidateItems(
      html.slice(html.indexOf("candidates")),
    );
    expect(first).toMatch(
      /<a[^>]*href="\/versions\/scout-for-lol%3Ar41"[^>]*><span class="revision">r41<\/span><\/a>/u,
    );
    expect(first).toContain('recipe <span class="mono">scout-prod/4</span>');
    expect(first).toContain(
      'configuration <span class="mono">scout-prod-config/7</span>',
    );
    expect(first).toContain('href="/deployments/scout-prod-41"');
    // A set revision the page has not loaded keeps its id: short in sight,
    // whole in the title and in the accessible text.
    expect(second).toContain(`href="/versions/${uuid}"`);
    expect(second).toContain(
      `<abbr class="mono identifier" title="${uuid}"><span aria-hidden="true">45cf1828</span><span class="visually-hidden">${uuid}</span></abbr>`,
    );
    expect(second).not.toContain('class="revision"');
    // The deployment id is short in sight and whole in the same two places.
    expect(second).toContain(
      `<abbr class="mono identifier" title="${deployment}"><span aria-hidden="true">0b6b6f0e</span><span class="visually-hidden">${deployment}</span></abbr>`,
    );
  });

  test("lists the first five candidates and collapses the older ones behind their count", () => {
    const html = environment(true, { candidates: manyCandidates(8) });
    const list = html.slice(html.indexOf("candidates"));
    const [shown = "", older = ""] = list.split("<details");
    expect(candidateItems(shown)).toHaveLength(5);
    expect(candidateItems(older)).toHaveLength(3);
    expect(older).toContain(
      '<summary><span class="disclosure-label">Older candidates</span><span class="disclosure-count">3</span></summary>',
    );
    // The collapsed list is closed, continues the numbering, and still
    // offers every older candidate.
    expect(older).toMatch(/^ class="disclosure">/u);
    expect(older).toContain('<ol class="candidates" start="6">');
    for (const id of ["deployment-6", "deployment-7", "deployment-8"])
      expect(older).toContain(`href="/deployments/${id}"`);
    expect(older.match(/>Roll back to this<\/button>/gu)).toHaveLength(3);
  });

  test("the accepted candidate stays in sight when it is older than the first five", () => {
    const html = environment(true, {
      candidates: manyCandidates(8),
      selection: {
        ...fixtures.selections.prod,
        acceptedDeploymentId: "deployment-7",
      },
    });
    const list = html.slice(html.indexOf("candidates"));
    const [shown = "", older = ""] = list.split("<details");
    const visible = candidateItems(shown);
    expect(visible).toHaveLength(6);
    expect(visible[5]).toContain('href="/deployments/deployment-7"');
    expect(visible[5]).toContain("Accepted now");
    expect(visible[5]).toContain(">Re-assert this selection</button>");
    expect(older).not.toContain("deployment-7");
    expect(older).toContain('<span class="disclosure-count">2</span>');
    expect(older).toContain('<ol class="candidates" start="7">');
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

  test("a settled monitor reads as a success and an alarmed one as an error", () => {
    const settled = markup(
      <MonitorPanel
        status={{
          ...fixtures.monitors.beta,
          state: "settled",
          settledAt: fixtures.monitors.unmonitored.settledAt,
        }}
      />,
    );
    expect(settled).toMatch(
      /<p class="notice success">Settled .*every evidence count/u,
    );
    expect(markup(<MonitorPanel status={fixtures.monitors.prod} />)).toMatch(
      /<p class="notice error">An alarm fired/u,
    );
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

  test.each([
    undefined,
    "verified-restore",
    "retained-volume-restart",
  ] as const)(
    "a Minecraft deployment's intents stay listed under release mode %s, since no specialized panel shows them",
    async (releaseMode) => {
      const quarantined = fixtures.deploymentDetails.find(
        (detail) => detail.recoveryIntents.length > 0,
      );
      if (quarantined === undefined) throw new Error("fixture detail");
      const definition = PipelineDefinitionSchema.parse(
        await Bun.file(
          new URL(
            "../../../registrations/specialized/minecraft-tsmc/pipeline.json",
            import.meta.url,
          ),
        ).json(),
      );
      if (definition.kind !== "argocd" || !definition.minecraftUpgrade)
        throw new Error("Expected the Minecraft policy");
      if (releaseMode === undefined)
        delete definition.minecraftUpgrade.releaseMode;
      else definition.minecraftUpgrade.releaseMode = releaseMode;
      const minecraft = {
        ...fixtures.recoveryIntents.pending,
        id: "scout-prod-37/recovery/4",
        kind: "minecraft" as const,
        sequence: 4,
      };
      const detail = {
        ...quarantined,
        pipeline: { ...quarantined.pipeline, definition },
        deployment: { ...quarantined.deployment, recoveryRequired: true },
        recoveryIntents: [minecraft],
      };
      expect(specializedRecoveryShown(detail, "minecraft")).toBe(false);
      const listed = render(<DeploymentModel detail={detail} />);
      expect(listed).toContain("/recovery-intents/scout-prod-37/recovery/4");
      expect(listed).toContain("Intent 4");
      expect(listed).toContain("minecraft");
      // With no intent yet, the generic panel still says how to request one.
      expect(
        render(<DeploymentModel detail={{ ...detail, recoveryIntents: [] }} />),
      ).toContain("No inspection has been requested");
    },
  );
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

/**
 * The release form for the prod environment under one release kind, with a
 * version beta has not accepted chosen.
 */
function releaseForm(releaseKind: "deploy" | "operator-run") {
  const detail = fixtures.environmentDetails.prod;
  const unaccepted = detail.versionSets.find(
    (version) =>
      version.id !== detail.sourceEnvironment?.acceptedVersionSetRevisionId,
  );
  if (unaccepted === undefined) throw new Error("fixture has another version");
  return render(
    <ReleaseForm
      detail={{ ...detail, releaseKind }}
      permitted
      blocker={null}
      planWaiting={false}
      initialKind="deploy"
      initialVersion={unaccepted.id}
      onRequested={() => Promise.resolve()}
    />,
  );
}

describe("release form", () => {
  test("requests the release kind the server reports, not the pipeline's own", () => {
    // The server reports the release kind from the declared recipe's stored
    // kind; the form follows it rather than reading the pipeline it shows.
    const operated = releaseForm("operator-run");
    expect(operated).toContain("Run a version with the operator tool");
    expect(operated).not.toContain("Ask for an override approval");
    const deployed = releaseForm("deploy");
    expect(deployed).toContain("Deploy a version");
    expect(deployed).toContain("Ask for an override approval");
  });
});

describe("what stops an environment from taking a request", () => {
  const { prod } = fixtures.environmentDetails;
  const { quarantined37, rollback43, pending44, override45 } =
    fixtures.deployments;
  const idle = { ...prod.environment, activeDeploymentId: null };

  test("a recovery-required owner locks it", () => {
    expect(
      environmentBlocker({
        environment: { activeDeploymentId: quarantined37.id },
        deployments: [quarantined37, pending44],
      }),
    ).toEqual({ kind: "locked", deployment: quarantined37 });
  });

  test("the owner, else the newest queued or waiting one, is in flight with the rest behind it", () => {
    expect(environmentBlocker(prod)).toMatchObject({
      kind: "in-flight",
      deployment: { id: rollback43.id, status: "running" },
      behind: 2,
    });
    expect(
      environmentBlocker({
        environment: idle,
        deployments: [override45, pending44, quarantined37],
      }),
    ).toEqual({ kind: "in-flight", deployment: override45, behind: 1 });
  });

  test("an owner the page has not loaded is named by its id; an idle environment has nothing", () => {
    expect(
      environmentBlocker({
        environment: { activeDeploymentId: "scout-prod-99" },
        deployments: [quarantined37],
      }),
    ).toEqual({ kind: "held", deploymentId: "scout-prod-99" });
    expect(
      environmentBlocker({ environment: idle, deployments: [quarantined37] }),
    ).toBeNull();
  });

  test("a running deployment whose saved plan waits reads as awaiting plan approval", () => {
    expect(inFlightWords("running", true)).toBe("awaiting plan approval");
    expect(inFlightStatus("running", true)).toBe("awaiting_approval");
    expect(inFlightWords("awaiting_approval", false)).toBe("awaiting approval");
    expect(inFlightWords("running", false)).toBe("running");
  });

  test("the top of the page says recovery is required, linked to the failed deployment", () => {
    const locked: Blocker = { kind: "locked", deployment: quarantined37 };
    const notice = markup(
      <EnvironmentNotice blocker={locked} planWaiting={false} />,
    );
    expect(notice).toMatch(/^<div class="notice error environment-notice">/u);
    expect(notice).toContain("<strong>Recovery required:</strong> deployment");
    expect(notice).toContain('href="/deployments/scout-prod-37"');
    expect(notice).toContain("A change may still be running outside Delivery");
    expect(notice).not.toContain("In flight");
    const summary = markup(
      <InFlightSummary
        blocker={locked}
        planWaiting={false}
        environmentId={fixtures.PROD}
        revisions={REVISIONS}
      />,
    );
    expect(summary).toContain("Recovery required");
    expect(summary).not.toContain("In flight");
  });

  test("a deployment in flight is named with its state", () => {
    const waiting: Blocker = {
      kind: "in-flight",
      deployment: pending44,
      behind: 1,
    };
    expect(
      markup(<EnvironmentNotice blocker={waiting} planWaiting={false} />),
    ).toMatch(
      /^<p class="notice info environment-notice"><strong>In flight:<\/strong> deployment .*is awaiting approval and 1 more wait behind it\./u,
    );
    const summary = markup(
      <InFlightSummary
        blocker={{ ...waiting, deployment: rollback43 }}
        planWaiting
        environmentId={fixtures.PROD}
        revisions={REVISIONS}
      />,
    );
    expect(summary).toContain("In flight:");
    expect(summary).toContain("awaiting plan approval");
    expect(summary).toContain('class="status status-awaiting_approval"');
    expect(markup(<EnvironmentNotice blocker={null} planWaiting />)).toBe("");
  });

  test("rollback and rebind are disabled with a reason that links the deployment in the way", () => {
    const html = environment(true, {
      blocker: { kind: "in-flight", deployment: pending44, behind: 0 },
    });
    const items = candidateItems(html.slice(html.indexOf("candidates")));
    expect(items.every((item) => item.includes('disabled=""'))).toBe(true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rebind</u);
    const reasons = [
      ...html.matchAll(/<p class="notice" id="([^"]+)">Deployment <a/gu),
    ].map((match) => match[1] ?? "");
    // The selection panel's reason and the candidates' reason.
    expect(reasons).toHaveLength(2);
    for (const id of reasons) expect(html).toContain(id);
    expect(html).toContain('href="/deployments/scout-prod-44"');
    expect(html).toContain(
      "is awaiting approval. Requests are refused until it finishes or is canceled.",
    );
  });
});

/** The release form for one environment detail, with what the page knows. */
function requestForm(
  props: Partial<Parameters<typeof ReleaseForm>[0]> = {},
  seed?: (client: QueryClient) => void,
) {
  return render(
    <ReleaseForm
      detail={fixtures.environmentDetails.prod}
      permitted
      blocker={null}
      planWaiting={false}
      initialKind={undefined}
      onRequested={() => Promise.resolve()}
      {...props}
    />,
    seed,
  );
}

/** Production's selection view once its accepted selection uses the declared binding. */
function boundAsDeclared(client: QueryClient) {
  client.setQueryData(queries.selection(fixtures.PROD).queryKey, {
    ...fixtures.selections.prod,
    declared: {
      ...fixtures.selections.prod.declared,
      configurationRevisionId:
        fixtures.selections.prod.accepted?.configurationRevisionId ?? "",
    },
  });
}

/** Production's selection view as seeded: it declares a newer configuration than it accepted. */
function rebinding(client: QueryClient) {
  client.setQueryData(
    queries.selection(fixtures.PROD).queryKey,
    fixtures.selections.prod,
  );
}

describe("the release form invites only a request that can succeed", () => {
  const { prod } = fixtures.environmentDetails;

  test("a locked environment disables the request and links the failed deployment", () => {
    const html = requestForm({
      blocker: {
        kind: "locked",
        deployment: fixtures.deployments.quarantined37,
      },
    });
    const [, reason = ""] =
      /<p class="notice" id="([^"]+)">Deployment <a[^>]*href="\/deployments\/scout-prod-37"/u.exec(
        html,
      ) ?? [];
    expect(reason).not.toBe("");
    expect(html).toContain(
      `<button type="submit" class="primary-button" disabled="" aria-describedby="${reason}">Request deployment</button>`,
    );
    expect(html).toContain("failed and needs recovery");
  });

  test("promoting the release already accepted here is disabled with its reason", () => {
    // Beta and prod both accepted r42, and prod's accepted selection uses its declared binding.
    const html = requestForm({ initialKind: "promote" }, boundAsDeclared);
    expect(html).toContain(
      "r42 is already accepted here, so promoting it from scout-for-lol/beta would change nothing.",
    );
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/u);
    // Left to choose, the form starts on a deploy instead.
    expect(requestForm({}, boundAsDeclared)).toMatch(
      /<option value="deploy" selected="">Deploy a version<\/option>/u,
    );
  });

  test("promoting an accepted release under a changed binding stays available", () => {
    // Prod declares a newer configuration than its accepted selection froze.
    const html = requestForm({ initialKind: "promote" }, rebinding);
    expect(html).not.toContain("would change nothing");
    expect(html).not.toMatch(/<button type="submit"[^>]*disabled=""/u);
    // Before the selection view loads, nothing is known, so nothing is refused.
    expect(requestForm({ initialKind: "promote" })).not.toContain(
      "would change nothing",
    );
  });

  test("no version yet says so, links the pipeline and disables the request", () => {
    const html = requestForm({
      detail: { ...prod, versionSets: [] },
      initialKind: "deploy",
    });
    expect(html).toContain(
      "No version of Scout for LoL has been published yet",
    );
    expect(html).toContain('href="/pipelines/scout-for-lol"');
    expect(html).not.toContain('<select name="version"');
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/u);
  });

  test("the override choice appears only for a chosen version it applies to", () => {
    expect(requestForm({ initialKind: "deploy" })).not.toContain(
      "Ask for an override approval",
    );
    const accepted = requestForm({
      initialKind: "deploy",
      initialVersion: "scout-for-lol:r42",
    });
    expect(accepted).not.toContain("Ask for an override approval");
    const unaccepted = requestForm({
      initialKind: "deploy",
      initialVersion: "scout-for-lol:r40",
    });
    expect(unaccepted).toContain("Ask for an override approval");
    expect(unaccepted).toContain(
      "scout-for-lol/beta has not accepted this version, so an ordinary deploy refuses it.",
    );
  });

  test("a version reads as its revision, commit and age, not its id", () => {
    const html = requestForm({ initialKind: "deploy" });
    const labels = [
      ...html.matchAll(/<option value="scout[^"]*">([^<]+)</gu),
    ].map((match) => match[1] ?? "");
    expect(labels).toHaveLength(5);
    for (const label of labels)
      expect(label).toMatch(/^r\d+ · [0-9a-f]{7} · /u);
    expect(html).not.toContain("· scout-for-lol:r");
  });

  test("an alarm on the accepted release is mentioned beside the button", () => {
    const html = requestForm({}, (client) => {
      client.setQueryData(queries.monitor(fixtures.PROD).queryKey, {
        ...fixtures.monitors.prod,
        policy: "hold",
      });
    });
    expect(html).toContain(
      "An alarm fired on the accepted release and the environment is held for an operator.",
    );
    expect(html).toContain('href="#monitor-heading"');
  });

  test("component digests fold away behind a count while versions stay in sight", () => {
    const from = fixtures.versionSets.at(0);
    const to = fixtures.versionSets.at(-1);
    if (from === undefined || to === undefined) throw new Error("fixtures");
    const html = requestForm(
      { initialKind: "deploy", initialVersion: to.id },
      (client) => {
        client.setQueryData(
          ["diff", prod.environment.desiredVersionSetRevisionId, to.id],
          diffVersionSets(from, to),
        );
      },
    );
    const diff = html.slice(html.indexOf('<div class="diff">'));
    const [inSight = "", folded = ""] = diff.split("<details");
    expect(inSight).toContain("image:scout-for-lol");
    expect(inSight).toContain("2026.10.22");
    expect(inSight).not.toContain("sha256:");
    expect(folded).toContain(
      '<span class="disclosure-label">Digests</span><span class="disclosure-count">1</span>',
    );
    expect(folded).toContain("sha256:");
  });
});

describe("monitor numbers and wording", () => {
  test("evidence reads to two decimals at most", () => {
    expect(formatEvidence(55.4212888888889)).toBe("55.42");
    expect(formatEvidence(50)).toBe("50");
    const status = fixtures.monitors.prod;
    const latest = status.latestObservation;
    if (latest === null) throw new Error("fixture has an observation");
    const html = markup(
      <MonitorPanel
        status={{
          ...status,
          latestObservation: {
            ...latest,
            evidence: { ...latest.evidence, "matches-processed": 55.4212889 },
          },
        }}
      />,
    );
    expect(html).toContain("55.42 of 50");
    expect(html).not.toContain("55.421");
  });

  test("with nothing accepted, no monitor does not claim a settled selection", () => {
    const html = markup(
      <MonitorPanel
        status={{ ...fixtures.monitors.unmonitored, deploymentId: null }}
      />,
    );
    expect(html).toContain("nothing has been accepted here yet");
    expect(html).not.toContain("settled on acceptance");
  });
});

describe("human decisions", () => {
  test("a release decision marks its reason required and asks before rejecting", () => {
    const html = render(<ApprovalForm onDecision={() => Promise.resolve()} />);
    expect(html).toContain("Reason (required)");
    expect(html).toMatch(/<textarea[^>]*required=""[^>]*aria-invalid="false"/u);
    expect(html).toMatch(
      /<button type="submit" class="primary-button">Approve release<\/button>/u,
    );
    // Reject is a confirm button: it opens the page's one dialog first.
    expect(html).toMatch(
      /<button type="button" class="secondary-button danger">Reject<\/button>/u,
    );
  });

  test("a plan decision marks its reason required", () => {
    expect(plan(fixtures.planWaiting)).toContain("Reason (required)");
  });
});
