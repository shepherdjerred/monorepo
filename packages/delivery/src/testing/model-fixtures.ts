import { StageSchema } from "#shared/contract.ts";
import { CatalogDocumentSchema } from "#shared/model/catalog-contract.ts";
import {
  ColdStartSnapshotSchema,
  RestoreHoldSchema,
} from "#shared/model/cold-start-contract.ts";
import {
  MonitorObservationSchema,
  MonitorSchema,
  MonitorStatusSchema,
  WatchingMonitorSchema,
} from "#shared/model/monitor-contract.ts";
import {
  CatalogReconcileResultSchema,
  CatalogStateSchema,
  DeploymentDetailV2Schema,
  EnvironmentSelectionSchema,
  ReconcileAfterRestoreSchema,
  ServiceLifecycleViewSchema,
} from "#shared/model/route-contract.ts";
import { RollbackCandidatesSchema } from "#shared/model/selection-contract.ts";
import { catalogDocument as document } from "./catalog-fixture.ts";
import * as records from "./model-records.ts";

/**
 * Contract-validated responses of the model routes for one monitored
 * service, Scout for LoL, so hub tests, the browser fixture server and
 * toolkit tests read the same shapes. Every value is parsed at import: a
 * contract change that these fixtures no longer satisfy fails loudly.
 */

const { at, digest, selection, service, sha } = records;
export const PROD = records.PROD;
export const BETA = records.BETA;
export const operator = records.operator;
export const versionSets = records.versionSets;
export const environments = records.environments;
export const deployments = records.deployments;
export const approvals = records.approvals;
export const approvalQueue = records.approvalQueue;
export const recoveryIntents = records.recoveryIntents;
export const deploymentDetails = records.deploymentDetails;
export const environmentDetails = records.environmentDetails;
export const overview = records.overview;
export const runtime = records.runtime;
export function recordedDeployment(
  ...input: Parameters<typeof records.deployment>
) {
  return records.deployment(...input);
}
export function deploymentDetail(
  ...input: Parameters<typeof records.deploymentDetail>
) {
  return records.deploymentDetail(...input);
}

export const selections = {
  prod: EnvironmentSelectionSchema.parse({
    accepted: selection(42, 4, 7),
    acceptedDeploymentId: "scout-prod-42",
    declared: {
      recipeRevisionId: "scout-prod/4",
      recipeKind: "kubernetes-application",
      configurationRevisionId: "scout-prod-config/8",
    },
    role: "durable",
    lifecycle: "active",
    approvalPolicy: "required",
    bindingGeneration: 12,
  }),
  beta: EnvironmentSelectionSchema.parse({
    accepted: selection(42, 4, 7),
    acceptedDeploymentId: "scout-beta-17",
    declared: {
      recipeRevisionId: "scout-prod/4",
      recipeKind: "kubernetes-application",
      configurationRevisionId: "scout-prod-config/7",
    },
    role: "durable",
    lifecycle: "active",
    approvalPolicy: "none",
    bindingGeneration: 30,
  }),
};

const scoutMonitor = (environmentName: string, thresholds: [number, number]) =>
  MonitorSchema.parse({
    component: "image:scout-for-lol",
    alarms: {
      matchers: { alertname: "~Scout.*", environment: environmentName },
    },
    evidence: [
      {
        key: "matches-processed",
        query: `sum(increase(scout_durable_receipts_recorded_total{environment="${environmentName}",git_sha="$gitSha",outcome="applied"}[$window]))`,
        threshold: thresholds[0],
      },
      {
        key: "discord-interactions",
        query: `sum(increase(discord_commands_total{environment="${environmentName}",git_sha="$gitSha"}[$window]))`,
        threshold: thresholds[1],
      },
    ],
    policy: environmentName === "prod" ? "automatic" : "hold",
  });

export const monitors = {
  prod: MonitorStatusSchema.parse({
    deploymentId: "scout-prod-42",
    state: "alarmed",
    policy: "automatic",
    settledAt: null,
    alarmedAt: at(56),
    observations: 4,
    monitor: scoutMonitor("prod", [50, 20]),
    latestObservation: {
      id: "observation/scout-prod-42/4",
      deploymentId: "scout-prod-42",
      sequence: 4,
      observedAt: at(56),
      window: "14m",
      alarms: [
        {
          alertname: "ScoutDurableReceiptsStalled",
          severity: "critical",
          labels: { environment: "prod", namespace: "scout-for-lol" },
          activeAt: at(54),
        },
      ],
      evidence: { "matches-processed": 12, "discord-interactions": 21 },
      outcome: "alarmed",
      createdAt: at(56),
    },
  }),
  beta: MonitorStatusSchema.parse({
    deploymentId: "scout-beta-17",
    state: "watching",
    policy: "hold",
    settledAt: null,
    alarmedAt: null,
    observations: 2,
    monitor: scoutMonitor("beta", [5, 3]),
    latestObservation: {
      id: "observation/scout-beta-17/2",
      deploymentId: "scout-beta-17",
      sequence: 2,
      observedAt: at(57),
      window: "6m",
      alarms: [],
      evidence: { "matches-processed": 3, "discord-interactions": 1 },
      outcome: "watching",
      createdAt: at(57),
    },
  }),
  unmonitored: MonitorStatusSchema.parse({
    deploymentId: "arcade-prod-9",
    state: "unmonitored",
    policy: null,
    settledAt: at(30),
    alarmedAt: null,
    observations: 0,
    monitor: null,
    latestObservation: null,
  }),
};

export const rollbackCandidates = {
  prod: RollbackCandidatesSchema.parse({
    candidates: [
      {
        deploymentId: "scout-prod-41",
        selection: selection(41, 4, 7),
        acceptedAt: at(42),
        eligible: true,
        reason: null,
      },
      {
        deploymentId: "scout-prod-40",
        selection: selection(39, 4, 7),
        acceptedAt: at(41),
        eligible: true,
        reason: null,
      },
      {
        deploymentId: "scout-prod-39",
        selection: selection(39, 4, 6),
        acceptedAt: at(40),
        eligible: false,
        reason:
          "Crosses forwardOnly configuration key MATCH_STORE_SCHEMA, changed by scout-prod-config/7 after this selection was accepted",
      },
      {
        deploymentId: "scout-prod-38",
        selection: selection(38, 3, 6),
        acceptedAt: at(39),
        eligible: false,
        reason:
          "Step migrate-schema is a point of no return and ran in scout-prod-39 after this selection was accepted",
      },
    ],
  }),
  beta: RollbackCandidatesSchema.parse({ candidates: [] }),
};

export const watching = [
  WatchingMonitorSchema.parse({
    deploymentId: "scout-beta-17",
    environmentId: BETA,
    serviceId: service,
    acceptedAt: at(51),
    monitor: monitors.beta.monitor,
    artifact: {
      component: "image:scout-for-lol",
      version: "2026.10.22",
      gitSha: sha("2"),
      digest: digest("2"),
    },
  }),
];
export const observation = MonitorObservationSchema.parse(
  monitors.beta.latestObservation,
);

/** A parsed catalog document the reconcile route accepts. */
export async function catalogDocument() {
  return CatalogDocumentSchema.parse(await document());
}

export const catalog = {
  state: CatalogStateSchema.parse({
    catalogRevision: digest("c"),
    reconciledAt: at(1),
  }),
  reconcile: CatalogReconcileResultSchema.parse({
    catalogRevision: digest("c"),
    created: {
      services: 1,
      environments: 2,
      recipes: 1,
      configurations: 1,
      edges: 0,
      carriedSelections: 0,
    },
    unchanged: 40,
    refused: [],
  }),
};

export const retiredService = ServiceLifecycleViewSchema.parse({
  id: "webring-legacy",
  lifecycle: "retired",
});

/** What reconcile-after-restore leaves on an environment it held (section 6). */
export const restoreHold = RestoreHoldSchema.parse({
  catalogRevision: digest("c"),
  reason: "Live target and snapshot run r41; the record accepted r42",
  heldAt: at(57),
});

export const restoreComparison = ReconcileAfterRestoreSchema.parse({
  environments: [
    {
      id: PROD,
      record: selection(42, 4, 7),
      snapshot: selection(42, 4, 7),
      live: selection(42, 4, 7),
      status: "match",
    },
    {
      id: BETA,
      record: selection(42, 4, 7),
      snapshot: selection(41, 4, 7),
      live: selection(41, 4, 7),
      status: "held",
      reason: "Live target and snapshot run r41; the record accepted r42",
    },
  ],
});

export const attestedStage = StageSchema.parse({
  id: "cluster-admission-prod-3/canary",
  deploymentId: "cluster-admission-prod-3",
  key: "canary",
  status: "succeeded",
  operationId: "cluster-admission-prod-3/canary/1",
  message: "Operator attested the admission canary",
  startedAt: at(10),
  updatedAt: at(11),
});

/** A cold-start snapshot naming revisions of `catalogDocument()`. */
export const coldStartSnapshot = ColdStartSnapshotSchema.parse({
  writtenAt: at(58),
  catalogRevision: digest("c"),
  environments: [
    {
      environmentId: "delivery/prod",
      deploymentId: "delivery-prod-7",
      acceptedAt: at(50),
      selection: {
        versionSetRevisionId: "delivery:r7",
        recipeRevisionId: "delivery/3",
        configurationRevisionId: "delivery/1",
      },
      artifacts: {
        "image:delivery": {
          uri: "ghcr.io/shepherdjerred/delivery",
          version: "2026.10.21",
          digest: digest("d"),
        },
        "chart:delivery": {
          uri: "https://chartmuseum.sjer.red/charts/delivery-1.4.0.tgz",
          version: "1.4.0",
          digest: digest("e"),
        },
      },
    },
    {
      environmentId: "sjer-red/prod",
      deploymentId: "sjer-red-prod-3",
      acceptedAt: at(40),
      selection: {
        versionSetRevisionId: "sjer-red:r3",
        recipeRevisionId: "sjer-red/1",
        configurationRevisionId: "sjer-red/1",
      },
      artifacts: {
        "archive:sjer-red": {
          uri: "s3://delivery-artifacts/sites/sjer-red.tar.zst",
          version: "2026.10.20",
          digest: digest("a"),
        },
      },
    },
  ],
});

const planCreated = Date.parse(at(50));
/** The saved plan a model tofu deployment's plan step produced (section 5). */
export const savedPlan = {
  schema: "delivery-tofu-plan/v1" as const,
  deploymentId: "tofu-cloudflare-prod-7",
  sourceBuildId: "tofu-cloudflare:build:7",
  sourceRevision: sha("c"),
  stack: "cloudflare" as const,
  createdAt: new Date(planCreated).toISOString(),
  expiresAt: new Date(planCreated + 6 * 60 * 60 * 1000).toISOString(),
  planDigest: digest("7"),
  state: { lineage: "cloudflare-state", serial: 41 },
  nativeJob: {
    namespace: "delivery-platform-jobs" as const,
    name: `delivery-${"9".repeat(40)}`,
    uid: "33333333-3333-4333-8333-333333333333",
    specFingerprint: "f".repeat(64),
    requestId: "tofu-cloudflare-prod-7",
  },
  changes: { create: 2, update: 1, delete: 0, replace: 0 },
};

const planStage = (key: string, status: "running" | "succeeded") =>
  StageSchema.parse({
    id: `stage/tofu-cloudflare-prod-7/${key}`,
    deploymentId: "tofu-cloudflare-prod-7",
    key,
    status,
    operationId: `tofu-cloudflare-prod-7/${key}`,
    message: key === "step-plan" ? "Saved plan recorded" : "Waiting",
    startedAt: at(50),
    updatedAt: at(51),
  });

/** A model tofu deployment whose approve step waits for a human (section 5). */
export const planWaiting = DeploymentDetailV2Schema.parse({
  ...records.deploymentDetail(records.deployments.settled41),
  deployment: {
    ...records.deployments.settled41,
    id: "tofu-cloudflare-prod-7",
    environmentId: "tofu-cloudflare/prod",
    serviceId: "tofu-cloudflare",
    pipelineRevisionId: "tofu-cloudflare/1",
    configurationId: "tofu-cloudflare/1",
    status: "running",
    finishedAt: null,
    selection: {
      versionSetRevisionId: "tofu-cloudflare:r7",
      recipeRevisionId: "tofu-cloudflare/1",
      configurationRevisionId: "tofu-cloudflare/1",
    },
  },
  pipeline: {
    id: "tofu-cloudflare/1",
    definition: {
      kind: "tofu",
      stack: "cloudflare",
      archiveComponent: "archive:tofu-cloudflare",
      runner: { service: "ci", component: "image:ci-base" },
      steps: ["plan", "approve", "apply"].map((kind) => ({
        kind,
        instance: "stack:cloudflare",
      })),
      sharedLock: "platform",
    },
    createdAt: at(0),
  },
  stages: [
    planStage("step-plan", "succeeded"),
    planStage("step-approve", "running"),
  ],
  savedPlan,
});
