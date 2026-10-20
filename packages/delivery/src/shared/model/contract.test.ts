import { describe, expect, test } from "vitest";
import {
  ApprovalV2InputSchema,
  ApprovalV2Schema,
  CreateDeploymentV2Schema,
  DeploymentKindV2Schema,
  RecoveryIntentKindSchema,
  RecoveryIntentV2Schema,
  RollbackCandidatesSchema,
  SelectionSchema,
} from "./contract.ts";
import { EvidenceInputSchema } from "#shared/evidence-contract.ts";

const at = "2026-10-20T12:00:00.000Z";

describe("CreateDeploymentV2Schema", () => {
  const request = {
    requestId: "req-1",
    environmentId: "arcade/prod",
    expectedGeneration: 4,
  };

  test.each([
    ["deploy", { kind: "deploy", versionSetRevisionId: "arcade/12" }],
    [
      "an override deploy",
      { kind: "deploy", versionSetRevisionId: "arcade/9", override: true },
    ],
    ["promote", { kind: "promote", sourceEnvironmentId: "arcade/beta" }],
    ["rollback", { kind: "rollback", selectionDeploymentId: "dep-7" }],
    ["rebind of the recipe", { kind: "rebind", recipeRevisionId: "arcade/4" }],
    [
      "rebind of the configuration",
      { kind: "rebind", configurationRevisionId: "arcade/2" },
    ],
    ["retire-host", { kind: "retire-host", hostId: "host-3" }],
    [
      "channel-publish",
      { kind: "channel-publish", versionSetRevisionId: "webring/5" },
    ],
    [
      "operator-run",
      { kind: "operator-run", versionSetRevisionId: "cluster-admission/2" },
    ],
  ])("accepts %s", (_name, fields) => {
    const parsed = CreateDeploymentV2Schema.parse({ ...request, ...fields });
    expect(parsed.override).toBe("override" in fields);
  });

  test.each([
    ["a deploy without a set revision", { kind: "deploy" }],
    ["a rollback without its selection deployment", { kind: "rollback" }],
    [
      "a rollback that also names a set revision",
      {
        kind: "rollback",
        selectionDeploymentId: "dep-7",
        versionSetRevisionId: "arcade/12",
      },
    ],
    ["a rebind with nothing to rebind", { kind: "rebind" }],
    [
      "a deploy carrying a recipe revision",
      {
        kind: "deploy",
        versionSetRevisionId: "arcade/12",
        recipeRevisionId: "arcade/4",
      },
    ],
    ["a retire-host without a host", { kind: "retire-host" }],
    ["an override on a promote", { kind: "promote", override: true }],
    [
      "a source environment on a deploy",
      {
        kind: "deploy",
        versionSetRevisionId: "arcade/12",
        sourceEnvironmentId: "arcade/beta",
      },
    ],
    ["an unknown kind", { kind: "root-release" }],
  ])("refuses %s", (_name, fields) => {
    expect(
      CreateDeploymentV2Schema.safeParse({ ...request, ...fields }).success,
    ).toBe(false);
  });

  test("lists the model's deployment kinds", () => {
    expect(DeploymentKindV2Schema.options).toEqual([
      "deploy",
      "promote",
      "rollback",
      "rebind",
      "retire-host",
      "channel-publish",
      "operator-run",
    ]);
  });
});

describe("ApprovalV2Schema", () => {
  const approval = {
    id: "apr-1",
    deploymentId: "dep-1",
    actor: "jerred",
    status: "granted",
    override: false,
    reason: "Reviewed the frozen selection",
    createdAt: at,
    decidedAt: at,
  };

  test("accepts decided, pending and expired approvals", () => {
    expect(ApprovalV2Schema.parse(approval).status).toBe("granted");
    expect(
      ApprovalV2Schema.parse({
        ...approval,
        status: "pending",
        actor: null,
        reason: null,
        decidedAt: null,
      }).decidedAt,
    ).toBeNull();
    expect(
      ApprovalV2Schema.parse({
        ...approval,
        status: "expired",
        actor: null,
        reason: null,
      }).status,
    ).toBe("expired");
    expect(
      ApprovalV2InputSchema.parse({ decision: "approve", reason: "ok" }),
    ).toEqual({
      decision: "approve",
      reason: "ok",
      override: false,
    });
  });

  test.each([
    ["a granted approval with no decision time", { decidedAt: null }],
    [
      "a pending approval with a decision time",
      { status: "pending", actor: null, reason: null },
    ],
    [
      "a pending approval that already names an approver",
      { status: "pending", reason: null, decidedAt: null },
    ],
    ["a rejection without a reason", { status: "rejected", reason: null }],
    ["a grant without an approver", { actor: null }],
  ])("refuses %s", (_name, overrides) => {
    expect(
      ApprovalV2Schema.safeParse({ ...approval, ...overrides }).success,
    ).toBe(false);
  });
});

describe("RecoveryIntentV2Schema", () => {
  const intent = {
    id: "intent-1",
    kind: "argo",
    deploymentId: "dep-1",
    sequence: 1,
    requestedBy: "jerred",
    reason: "Sync operation returned an ambiguous result",
    expectedGeneration: 4,
    fingerprint: `sha256:${"d".repeat(64)}`,
    outcome: "pending",
    createdAt: at,
  };

  test("defaults the step, evidence and settlement of a pending intent", () => {
    expect(RecoveryIntentV2Schema.parse(intent)).toMatchObject({
      step: null,
      evidence: [],
      settledAt: null,
    });
    expect(RecoveryIntentKindSchema.options).toEqual([
      "argo",
      "worker",
      "platform",
      "content",
      "minecraft",
      "forum-baseline",
    ]);
  });

  test("a settled intent names its step and settlement, a pending one neither", () => {
    expect(
      RecoveryIntentV2Schema.parse({
        ...intent,
        step: "static-site",
        outcome: "succeeded",
        settledAt: at,
        evidence: [
          { kind: "drift", summary: "Application matched the frozen source" },
        ],
      }).outcome,
    ).toBe("succeeded");
    expect(
      RecoveryIntentV2Schema.safeParse({ ...intent, outcome: "succeeded" })
        .success,
    ).toBe(false);
    expect(
      RecoveryIntentV2Schema.safeParse({ ...intent, settledAt: at }).success,
    ).toBe(false);
  });
});

describe("evidence kinds", () => {
  test("adds the model kinds beside the v1 kinds", () => {
    for (const kind of [
      "ci",
      "reconciliation",
      "monitor",
      "alarm",
      "test",
      "drift",
      "attestation",
    ]) {
      expect(
        EvidenceInputSchema.safeParse({ kind, summary: kind }).success,
      ).toBe(true);
    }
    expect(
      EvidenceInputSchema.safeParse({ kind: "vibes", summary: "no" }).success,
    ).toBe(false);
  });
});

describe("selections", () => {
  const selection = {
    versionSetRevisionId: "arcade/12",
    recipeRevisionId: "arcade/3",
    configurationRevisionId: "arcade/1",
  };

  test("a selection is the frozen triple", () => {
    expect(SelectionSchema.parse(selection)).toEqual(selection);
    expect(
      SelectionSchema.safeParse({ ...selection, recipeRevisionId: "arcade" })
        .success,
    ).toBe(false);
  });

  test("an excluded rollback candidate states its reason", () => {
    const eligible = {
      deploymentId: "dep-7",
      selection,
      acceptedAt: at,
      eligible: true,
      reason: null,
    };
    expect(
      RollbackCandidatesSchema.parse({
        candidates: [
          eligible,
          {
            ...eligible,
            deploymentId: "dep-6",
            eligible: false,
            reason: "Would lower forwardOnly key postgres.major from 17 to 16",
          },
        ],
      }).candidates,
    ).toHaveLength(2);
    expect(
      RollbackCandidatesSchema.safeParse({
        candidates: [{ ...eligible, eligible: false }],
      }).success,
    ).toBe(false);
  });
});
