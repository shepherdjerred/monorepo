import {
  EnvironmentSchema,
  OverviewSchema,
  PipelineRevisionSchema,
  PrincipalSchema,
  StageSchema,
  VersionSetRevisionSchema,
  type DeploymentDetail,
  type Environment,
} from "#shared/contract.ts";
import { EnvironmentDetailSchema } from "#shared/hub/hub-contract.ts";
import { ArgoRuntimeIntegrationSchema } from "#shared/hub/integration-contract.ts";
import { ApprovalV2Schema } from "#shared/model/approval-contract.ts";
import {
  ApprovalQueueItemSchema,
  DeploymentDetailV2Schema,
  DeploymentV2Schema,
  type DeploymentV2,
} from "#shared/model/route-contract.ts";
import { RecoveryIntentV2Schema } from "#shared/recovery-intent.ts";

/**
 * Recorded deployments, approvals and recovery intents of one monitored
 * service, Scout for LoL, as the hub's existing reads return them. The model
 * route fixtures in `model-fixtures.ts` describe the same history.
 */

export const service = "scout-for-lol";
export const PROD = `${service}/prod`;
export const BETA = `${service}/beta`;
export const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 20, 12, minute)).toISOString();
export const sha = (seed: string) => seed.repeat(40).slice(0, 40);
export const digest = (seed: string) =>
  `sha256:${seed.repeat(64).slice(0, 64)}`;

export const operator = PrincipalSchema.parse({
  id: "operator@example.com",
  kind: "human",
  scopes: ["read", "deploy", "approve"],
});

const versionSet = (revision: number) =>
  VersionSetRevisionSchema.parse({
    id: `${service}:r${String(revision)}`,
    serviceId: service,
    revision,
    baseRevisionId:
      revision === 38 ? null : `${service}:r${String(revision - 1)}`,
    lineage: "a".repeat(64),
    orderKey: `${String(revision).padStart(10, "0")}.0000000000`,
    components: {
      "image:scout-for-lol": {
        id: `${service}:image:${String(revision)}`,
        component: "image:scout-for-lol",
        kind: "image",
        uri: "ghcr.io/shepherdjerred/scout-for-lol",
        digest: digest(String(revision % 10)),
        version: `2026.10.${String(revision - 20)}`,
        serviceId: service,
        buildId: `${service}:build:${String(revision)}`,
        sourceRevision: sha(String(revision % 10)),
        createdAt: at(revision - 38),
      },
    },
    createdAt: at(revision - 38),
  });
export const versionSets = [38, 39, 40, 41, 42].map((revision) =>
  versionSet(revision),
);
const setId = (revision: number) => `${service}:r${String(revision)}`;

export const selection = (
  revision: number,
  recipe: number,
  configuration: number,
) => ({
  versionSetRevisionId: setId(revision),
  recipeRevisionId: `scout-prod/${String(recipe)}`,
  configurationRevisionId: `scout-prod-config/${String(configuration)}`,
});

const pipeline = PipelineRevisionSchema.parse({
  id: "scout-for-lol-prod/4",
  definition: {
    kind: "manual",
    reason: "Browser fixture for the model routes",
  },
  createdAt: at(0),
});

function environment(fields: Partial<Environment> & { id: string }) {
  return EnvironmentSchema.parse({
    serviceId: service,
    name: fields.id.slice(service.length + 1),
    application: fields.id.replace("/", "-"),
    pipelineRevisionId: pipeline.id,
    declaredConfigurationId: "scout-prod-config/7",
    automatic: false,
    role: "durable",
    lifecycle: "active",
    approvalPolicy: "none",
    acceptedDeploymentId: null,
    promotionSourceEnvironmentId: null,
    generation: 12,
    desiredVersionSetRevisionId: setId(42),
    observedVersionSetRevisionId: setId(42),
    acceptedVersionSetRevisionId: setId(42),
    observedAt: at(55),
    activeDeploymentId: null,
    createdAt: at(0),
    ...fields,
  });
}
export const environments = {
  prod: environment({
    id: PROD,
    promotionSourceEnvironmentId: BETA,
    approvalPolicy: "required",
    acceptedDeploymentId: "scout-prod-42",
    desiredVersionSetRevisionId: setId(41),
    activeDeploymentId: "scout-prod-43",
  }),
  beta: environment({
    id: BETA,
    automatic: true,
    role: "qualification",
    generation: 30,
    acceptedDeploymentId: "scout-beta-42",
  }),
};

type DeploymentFields = Partial<DeploymentV2> & {
  id: string;
  kind: DeploymentV2["kind"];
  status: DeploymentV2["status"];
  revision: number;
};
/** One recorded deployment of the fixture history; `revision` names its set revision. */
export function deployment({ revision, ...fields }: DeploymentFields) {
  const finished = ["succeeded", "failed", "canceled"].includes(fields.status);
  return DeploymentV2Schema.parse({
    requestId: `request/${fields.id}`,
    environmentId: PROD,
    serviceId: service,
    versionSetRevisionId: setId(revision),
    pipelineRevisionId: pipeline.id,
    configurationId: "scout-prod-config/7",
    catalogRevision: digest("c"),
    expectedGeneration: 11,
    requestedBy: operator.id,
    message: null,
    cancelRequested: false,
    recoveryRequired: false,
    createdAt: at(revision),
    startedAt: fields.status === "awaiting_approval" ? null : at(revision),
    finishedAt: finished ? at(revision + 1) : null,
    selection: selection(revision, 4, 7),
    ...fields,
  });
}

export const deployments = {
  settled38: deployment({
    id: "scout-prod-38",
    kind: "deploy",
    status: "succeeded",
    revision: 38,
    selection: selection(38, 3, 6),
    monitorState: "settled",
  }),
  settled41: deployment({
    id: "scout-prod-41",
    kind: "promote",
    status: "succeeded",
    revision: 41,
    sourceEnvironmentId: BETA,
    monitorState: "settled",
    previousAcceptedDeploymentId: "scout-prod-40",
  }),
  alarmed42: deployment({
    id: "scout-prod-42",
    kind: "promote",
    status: "succeeded",
    revision: 42,
    sourceEnvironmentId: BETA,
    monitorState: "alarmed",
    previousAcceptedDeploymentId: "scout-prod-41",
  }),
  rollback43: deployment({
    id: "scout-prod-43",
    kind: "rollback",
    status: "running",
    automatic: true,
    revision: 41,
    requestedBy: "delivery-monitor",
    message: "Monitor alarmed on scout-prod-42; restoring scout-prod-41",
    previousAcceptedDeploymentId: "scout-prod-42",
    restoredDeploymentId: "scout-prod-41",
    previousAcceptedVersionSetRevisionId: setId(42),
  }),
  pending44: deployment({
    id: "scout-prod-44",
    kind: "promote",
    status: "awaiting_approval",
    revision: 42,
    sourceEnvironmentId: BETA,
  }),
  override45: deployment({
    id: "scout-prod-45",
    kind: "deploy",
    status: "awaiting_approval",
    revision: 40,
    message: "Set revision r40 is not eligible: it was never accepted in beta",
  }),
  expired36: deployment({
    id: "scout-prod-36",
    kind: "promote",
    status: "canceled",
    revision: 39,
    sourceEnvironmentId: BETA,
    message: "Approval expired: the binding generation moved to 11",
  }),
  quarantined37: deployment({
    id: "scout-prod-37",
    kind: "deploy",
    status: "failed",
    revision: 39,
    recoveryRequired: true,
    message: "Sync result unknown after the executor lease expired",
  }),
};

export const approvals = {
  restoration: ApprovalV2Schema.parse({
    id: "approval/scout-prod-43",
    deploymentId: "scout-prod-43",
    actor: "operator@example.com",
    status: "granted",
    override: false,
    reason: "Restoration of the approval recorded for scout-prod-41 (H5)",
    createdAt: at(43),
    decidedAt: at(43),
  }),
  pending: ApprovalV2Schema.parse({
    id: "approval/scout-prod-44",
    deploymentId: "scout-prod-44",
    actor: null,
    status: "pending",
    override: false,
    reason: null,
    createdAt: at(44),
    decidedAt: null,
  }),
  override: ApprovalV2Schema.parse({
    id: "approval/scout-prod-45",
    deploymentId: "scout-prod-45",
    actor: null,
    status: "pending",
    override: true,
    reason: null,
    createdAt: at(45),
    decidedAt: null,
  }),
  expired: ApprovalV2Schema.parse({
    id: "approval/scout-prod-36",
    deploymentId: "scout-prod-36",
    actor: null,
    status: "expired",
    override: false,
    reason: null,
    createdAt: at(36),
    decidedAt: at(40),
  }),
};

export const approvalQueue = [
  { ...deployments.pending44, approval: approvals.pending },
  { ...deployments.override45, approval: approvals.override },
  { ...deployments.expired36, approval: approvals.expired },
].map((item) => ApprovalQueueItemSchema.parse(item));

const fingerprint = digest("f");
export const recoveryIntents = {
  failed: RecoveryIntentV2Schema.parse({
    id: "scout-prod-37/recovery/1",
    kind: "argo",
    deploymentId: "scout-prod-37",
    sequence: 1,
    step: "sync",
    requestedBy: "delivery-admin",
    reason: "Inspect the sync operation left ambiguous by the expired lease",
    expectedGeneration: 11,
    fingerprint,
    evidence: [
      {
        kind: "reconciliation",
        summary:
          "Application scout-for-lol-prod still reports operation 7 running; locks retained",
      },
    ],
    outcome: "failed",
    createdAt: at(38),
    settledAt: at(39),
  }),
  pending: RecoveryIntentV2Schema.parse({
    id: "scout-prod-37/recovery/2",
    kind: "argo",
    deploymentId: "scout-prod-37",
    sequence: 2,
    step: "sync",
    requestedBy: "delivery-admin",
    reason: "Re-read the sync operation now that ArgoCD finished operation 7",
    expectedGeneration: 11,
    fingerprint,
    evidence: [],
    outcome: "pending",
    createdAt: at(50),
    settledAt: null,
  }),
};

const stage = (
  key: string,
  status: "succeeded" | "running" | "failed",
  minute: number,
) =>
  StageSchema.parse({
    id: `scout-prod-43/${key}`,
    deploymentId: "scout-prod-43",
    key,
    status,
    operationId: `scout-prod-43/${key}/1`,
    message: status === "running" ? "Waiting for readback proof" : "",
    startedAt: at(minute),
    updatedAt: at(minute + 1),
  });

/** A v2 deployment detail for one fixture deployment. */
export function deploymentDetail(
  value: DeploymentV2,
  extras: Partial<Pick<DeploymentDetail, "stages" | "evidence">> & {
    approval?: (typeof approvals)[keyof typeof approvals];
    recoveryIntents?: (typeof recoveryIntents)[keyof typeof recoveryIntents][];
  } = {},
) {
  const revision = Number(value.versionSetRevisionId.split(":r")[1]);
  const previous = value.previousAcceptedVersionSetRevisionId;
  return DeploymentDetailV2Schema.parse({
    deployment: value,
    environment: environments.prod,
    versionSet: versionSet(revision),
    previousAcceptedVersionSet:
      previous === null ? null : versionSet(Number(previous.split(":r")[1])),
    pipeline,
    configuration: {
      id: value.configurationId,
      content: { "match-store.schema": "7" },
      forwardOnly: ["match-store.schema"],
    },
    evidence: extras.evidence ?? [],
    stages: extras.stages ?? [],
    approval: extras.approval ?? null,
    recoveryIntents: extras.recoveryIntents ?? [],
  });
}

export const deploymentDetails = [
  deploymentDetail(deployments.rollback43, {
    approval: approvals.restoration,
    stages: [stage("sync", "succeeded", 43), stage("readback", "running", 45)],
  }),
  deploymentDetail(deployments.alarmed42, {
    evidence: [
      {
        id: "evidence/scout-prod-42/alarm",
        deploymentId: "scout-prod-42",
        kind: "alarm",
        summary: "ScoutDurableReceiptsStalled (critical) fired while watching",
        createdAt: at(56),
      },
    ],
  }),
  deploymentDetail(deployments.settled41),
  deploymentDetail(deployments.settled38),
  deploymentDetail(deployments.pending44, { approval: approvals.pending }),
  deploymentDetail(deployments.override45, { approval: approvals.override }),
  deploymentDetail(deployments.expired36, { approval: approvals.expired }),
  deploymentDetail(deployments.quarantined37, {
    recoveryIntents: [recoveryIntents.failed, recoveryIntents.pending],
  }),
];

export const environmentDetails = {
  prod: EnvironmentDetailSchema.parse({
    environment: environments.prod,
    service: {
      id: service,
      title: "Scout for LoL",
      kind: "product",
      links: [],
    },
    pipeline,
    sourceEnvironment: environments.beta,
    restoreHold: null,
    releaseKind: "deploy",
    versionSets,
    deployments: Object.values(deployments),
    links: [],
  }),
  beta: EnvironmentDetailSchema.parse({
    environment: environments.beta,
    service: {
      id: service,
      title: "Scout for LoL",
      kind: "product",
      links: [],
    },
    pipeline,
    sourceEnvironment: null,
    restoreHold: null,
    releaseKind: "deploy",
    versionSets,
    deployments: [],
    links: [],
  }),
};

export const overview = OverviewSchema.parse({
  environments: [environments.prod, environments.beta],
  deployments: [],
  versionSets,
  artifacts: [],
});

export const runtime = ArgoRuntimeIntegrationSchema.parse({
  state: "unavailable",
  reason: "not-configured",
  detail: "The browser fixture has no ArgoCD",
  links: [],
});
