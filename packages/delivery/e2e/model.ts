import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { catalogDocument } from "#testing/catalog-fixture.ts";
import { publishCiRunner } from "#testing/model-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import type { EvidenceInput } from "#shared/contract.ts";
import {
  CHANNEL_PROD,
  OPERATOR_PROD,
  STACK_PROD,
  seedOperatorRun,
  seedWaitingPlan,
  withStack,
} from "./model-plan.ts";
import {
  HELD_PROD,
  IDLE_FAILED,
  INTERRUPTED,
  RECOVERY_PROD,
  seedHeldRetry,
  seedRecovery,
  withRecovery,
} from "./model-recovery.ts";

// The model state the browser specs read, built only through Delivery's own
// catalog, publication, request, approval, execution, monitor and restore
// APIs over a disposable database.

export const MODEL_PROD = "arcade/prod";
export const MODEL_BETA = "arcade/beta";
/** The third release's image, the one both Arcade environments accepted. */
export const MODEL_ACCEPTED_IMAGE = `docker.io/shepherdjerred/arcade@sha256:${"3".repeat(64)}`;
export const MODEL_ENVIRONMENTS = [
  MODEL_BETA,
  MODEL_PROD,
  "delivery/prod",
  "sjer-red/prod",
  STACK_PROD,
  OPERATOR_PROD,
  CHANNEL_PROD,
  RECOVERY_PROD,
  HELD_PROD,
  IDLE_FAILED,
  INTERRUPTED,
];

type Document = Awaited<ReturnType<typeof catalogDocument>>;
type Recipe = Document["recipes"][number]["definition"];

/** The Arcade prod recipe with a hold-policy monitor (4.19), at an evidence threshold. */
function monitored(recipe: Recipe, threshold: number): Recipe {
  if (recipe.kind !== "kubernetes-application")
    throw new Error("arcade converts to a Kubernetes application recipe");
  return {
    ...recipe,
    oracle: {
      ...recipe.oracle,
      monitor: {
        component: "image:arcade",
        alarms: {
          matchers: { environment: MODEL_PROD },
          severities: ["critical"],
        },
        evidence: [
          {
            key: "requests",
            query:
              'sum(increase(http_requests_total{version="$version"}[$window]))',
            threshold,
          },
        ],
        policy: "hold",
      },
    },
  };
}

/**
 * The fixture catalog with no automatic requests and no prerequisite edges,
 * a monitored prod recipe, and a forward-only schema key in Arcade's
 * configuration. Each later revision adds what arcade/prod then declares:
 * configuration arcade/2, then recipe arcade/4.
 */
function document(base: Document, revision: 1 | 2 | 3) {
  const prod = {
    recipe: revision === 3 ? "arcade/4" : "arcade/3",
    configuration: revision === 1 ? "arcade/1" : "arcade/2",
  };
  const arcade = base.recipes.find((entry) => entry.id === "arcade/3");
  if (arcade === undefined) throw new Error("fixture catalog has arcade/3");
  return withRecovery(
    withStack({
      ...base,
      edges: [],
      environments: base.environments.map((env) => ({
        ...env,
        automatic: false,
        ...(env.id === MODEL_PROD
          ? {
              recipeRevisionId: prod.recipe,
              configurationRevisionId: prod.configuration,
            }
          : {}),
      })),
      recipes: [
        ...base.recipes.filter((entry) => entry.id !== "arcade/3"),
        { id: "arcade/3", definition: monitored(arcade.definition, 100) },
        ...(revision === 3
          ? [{ id: "arcade/4", definition: monitored(arcade.definition, 250) }]
          : []),
      ],
      configurations: [
        ...base.configurations.filter((entry) => entry.id !== "arcade/1"),
        {
          id: "arcade/1",
          content: { "schema.version": "1" },
          forwardOnly: ["/helm/parameters/schema.version"],
        },
        ...(revision === 1
          ? []
          : [
              {
                id: "arcade/2",
                content: { "schema.version": "2" },
                forwardOnly: ["/helm/parameters/schema.version"],
              },
            ]),
      ],
    }),
  );
}

/** The catalog document the harness reconciles at one revision. */
export async function modelCatalog(revision: 1 | 2 | 3) {
  return document(await catalogDocument(), revision);
}

async function publish(delivery: Delivery, database: Database, n: number) {
  const tag = String(n);
  const build = await delivery.publish(
    {
      requestId: `model/publish/${tag}`,
      serviceId: "arcade",
      sourceRevision: tag.repeat(40),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(100 + n)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `model/image/${tag}`,
          component: "image:arcade",
          kind: "image",
          uri: "docker.io/shepherdjerred/arcade",
          version: `1.${tag}.0`,
          digest: `sha256:${tag.repeat(64)}`,
        },
        {
          id: `model/chart/${tag}`,
          component: "chart:arcade",
          kind: "chart",
          uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/arcade-1.${tag}.0.tgz`,
          version: `1.${tag}.0`,
          digest: `sha256:${String(n + 4).repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 100 + n },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const [newest] = await database.versionSet.findMany({
    where: { serviceId: "arcade" },
    orderBy: { revision: "desc" },
    take: 1,
  });
  if (newest === undefined) throw new Error("No set composed");
  return newest.id;
}

async function generation(database: Database, environmentId: string) {
  const env = await database.environment.findUniqueOrThrow({
    where: { id: environmentId },
  });
  return env.generation;
}

/**
 * What each step records, as the adapters write it: prose, or a JSON object
 * that is the step's machine receipt. The render step records nothing.
 */
const STEP_EVIDENCE: Record<string, EvidenceInput[]> = {
  "step-render": [],
  "step-sync": [
    { kind: "preflight", summary: "Application is owned by this deployment" },
    {
      kind: "reconciliation",
      summary: JSON.stringify({
        adapter: "kubernetes",
        step: "sync",
        application: "arcade",
        revision: "a".repeat(40),
        resources: { synced: 12, pruned: 0 },
        operation: {
          phase: "Succeeded",
          startedAt: "2026-01-01T00:00:00.000Z",
          syncResult: { source: { chart: "arcade", targetRevision: "1.3.0" } },
        },
      }),
    },
  ],
  "step-readback": [
    {
      kind: "runtime",
      summary: JSON.stringify({
        adapter: "kubernetes",
        step: "readback",
        health: "Healthy",
        images: [`docker.io/shepherdjerred/arcade@sha256:${"3".repeat(64)}`],
      }),
    },
  ],
};

/** Claim, record each step's stage and accept: what the executor reports. */
async function execute(
  delivery: Delivery,
  deployment: { id: string; versionSetRevisionId: string },
) {
  await delivery.claim(deployment.id, testExecutor);
  for (const [step, evidence] of Object.entries(STEP_EVIDENCE))
    await delivery.stage(
      deployment.id,
      {
        key: step,
        status: "succeeded",
        operationId: `${deployment.id}/${step}`,
        message: `${step.slice(5)} completed`,
        evidence,
      },
      testExecutor,
    );
  await delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Accepted",
      observedRevisionId: deployment.versionSetRevisionId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "exact operation completed" },
        { kind: "acceptance", summary: "acceptance checks passed" },
      ],
    },
    testExecutor,
  );
}

async function approve(delivery: Delivery, id: string, reason: string) {
  await delivery.approve(id, { decision: "approve", reason }, testOperator);
}

function observation(requests: number, critical = false) {
  return {
    observedAt: new Date().toISOString(),
    window: "15m",
    alarms: critical
      ? [
          {
            alertname: "ArcadeErrorBudgetBurn",
            severity: "critical" as const,
            labels: { environment: MODEL_PROD },
            // Active after the claim, so it counts against this deployment.
            activeAt: new Date().toISOString(),
          },
        ]
      : [],
    evidence: { requests },
  };
}

/** Deploy a set revision to beta, accept it, then promote it to prod with approval. */
async function release(
  delivery: Delivery,
  database: Database,
  setId: string,
  observed: { requests: number; critical?: boolean },
) {
  const beta = await delivery.createDeployment(
    {
      requestId: `model/beta/${setId}`,
      environmentId: MODEL_BETA,
      expectedGeneration: await generation(database, MODEL_BETA),
      kind: "deploy",
      versionSetRevisionId: setId,
    },
    testOperator,
  );
  await execute(delivery, beta);
  const prod = await delivery.createDeployment(
    {
      requestId: `model/prod/${setId}`,
      environmentId: MODEL_PROD,
      expectedGeneration: await generation(database, MODEL_PROD),
      kind: "promote",
      sourceEnvironmentId: MODEL_BETA,
    },
    testOperator,
  );
  await approve(delivery, prod.id, "Reviewed the promoted selection");
  await execute(delivery, prod);
  await delivery.observeMonitor(
    prod.id,
    observation(observed.requests, observed.critical),
    testExecutor,
  );
  return prod;
}

/**
 * Re-assert an accepted selection (D9): a rollback to it, approved and
 * accepted, which is one more previously accepted selection to restore.
 */
async function reassert(
  delivery: Delivery,
  database: Database,
  accepted: { id: string },
  n: number,
) {
  const rollback = await delivery.createDeployment(
    {
      requestId: `model/prod/reassert/${String(n)}`,
      environmentId: MODEL_PROD,
      expectedGeneration: await generation(database, MODEL_PROD),
      kind: "rollback",
      selectionDeploymentId: accepted.id,
    },
    testOperator,
  );
  await approve(delivery, rollback.id, "Re-asserted after a drifted target");
  await execute(delivery, rollback);
  await delivery.observeMonitor(rollback.id, observation(160), testExecutor);
}

/**
 * Three releases, two re-assertions of the first and a configuration rebind
 * of Arcade: six accepted selections, so the environment page collapses the
 * oldest. The newest is alarmed under a hold policy, the ones before the
 * rebind are excluded from rollback by a forward-only schema key, the
 * declared recipe is one the accepted selection does not use yet, and a
 * non-eligible deploy waits for an override approval.
 */
export async function seedModelBrowser(delivery: Delivery, database: Database) {
  const base = await catalogDocument();
  await delivery.reconcileCatalog(document(base, 1), testOperator);
  await publishCiRunner(delivery);
  const sets = [];
  for (const n of [1, 2, 3, 4]) sets.push(await publish(delivery, database, n));
  const [first, second, third, fourth] = sets;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined
  )
    throw new Error("Four set revisions were composed");
  const original = await release(delivery, database, first, { requests: 180 });
  for (const n of [1, 2]) await reassert(delivery, database, original, n);
  await release(delivery, database, second, { requests: 140 });
  // The catalog moves prod to configuration revision 2; a rebind realises it.
  await delivery.reconcileCatalog(document(base, 2), testOperator);
  const rebind = await delivery.createDeployment(
    {
      requestId: "model/prod/rebind",
      environmentId: MODEL_PROD,
      expectedGeneration: await generation(database, MODEL_PROD),
      kind: "rebind",
      configurationRevisionId: "arcade/2",
    },
    testOperator,
  );
  await approve(delivery, rebind.id, "Schema 2 migration reviewed");
  await execute(delivery, rebind);
  await delivery.observeMonitor(rebind.id, observation(120), testExecutor);
  await release(delivery, database, third, {
    requests: 40.256,
    critical: true,
  });
  await delivery.reconcileCatalog(document(base, 3), testOperator);
  // Never accepted in beta, so only an override approval admits it (H4).
  await delivery.createDeployment(
    {
      requestId: "model/prod/override",
      environmentId: MODEL_PROD,
      expectedGeneration: await generation(database, MODEL_PROD),
      kind: "deploy",
      versionSetRevisionId: fourth,
      override: true,
      message: "Hotfix for the error budget burn",
    },
    testOperator,
  );
  await settledInterruption(delivery, database, fourth);
  await quarantine(delivery, database, fourth);
  await seedWaitingPlan(delivery, database);
  await seedOperatorRun(delivery);
  await seedRecovery(delivery, database);
  await seedHeldRetry(delivery, database);
}

/** The request id of the beta deploy whose interrupted sync recovery has read back. */
export const SETTLED_REQUEST = "model/beta/settled";

/**
 * A beta deploy whose sync outlived its executor, as the quarantine below,
 * but whose recovery intent an independent reader has since settled: the
 * operation ended Failed, the locks are released, and the executor's
 * "may still be active" is stale (4.15).
 */
async function settledInterruption(
  delivery: Delivery,
  database: Database,
  setId: string,
) {
  const deployment = await delivery.createDeployment(
    {
      requestId: SETTLED_REQUEST,
      environmentId: MODEL_BETA,
      expectedGeneration: await generation(database, MODEL_BETA),
      kind: "deploy",
      versionSetRevisionId: setId,
    },
    testOperator,
  );
  await delivery.claim(deployment.id, testExecutor);
  await delivery.stage(
    deployment.id,
    {
      key: "step-sync",
      status: "running",
      operationId: `${deployment.id}/step-sync`,
      message: "step-sync: running",
      evidence: [],
    },
    testExecutor,
  );
  await delivery.finish(
    deployment.id,
    {
      status: "failed",
      message:
        "External operation may still be active; inspect its recorded identity before releasing ownership",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const intent = await delivery.requestRecoveryIntent(
    deployment.id,
    {
      requestId: "model/beta/settled/recovery",
      reason: "Independent Application readback of the recorded sync",
      expectedGeneration: await generation(database, MODEL_BETA),
    },
    testOperator,
  );
  await delivery.settleArgoIntent(
    intent.id,
    "Settled by independent Application readback of the finished operation",
    testOperator,
    [
      {
        kind: "reconciliation",
        operationId: `${deployment.id}/operation-6`,
        summary:
          "Independent Application readback: arcade-beta, operation 6, phase Failed, finished 2026-11-22T03:27:16Z",
      },
    ],
  );
}

/**
 * A beta deploy whose sync outlived its executor: its result is unknown, so
 * it keeps its locks until an independent reader settles a recovery intent
 * (4.15).
 */
async function quarantine(
  delivery: Delivery,
  database: Database,
  setId: string,
) {
  const deployment = await delivery.createDeployment(
    {
      requestId: "model/beta/quarantine",
      environmentId: MODEL_BETA,
      expectedGeneration: await generation(database, MODEL_BETA),
      kind: "deploy",
      versionSetRevisionId: setId,
    },
    testOperator,
  );
  await delivery.claim(deployment.id, testExecutor);
  await delivery.stage(
    deployment.id,
    {
      key: "step-sync",
      status: "running",
      operationId: `${deployment.id}/step-sync`,
      message: "ArgoCD sync operation 7 running",
      evidence: [
        {
          kind: "reconciliation",
          summary: JSON.stringify({
            adapter: "kubernetes",
            step: "sync",
            application: "arcade-beta",
            operation: 7,
            phase: "Running",
          }),
        },
      ],
    },
    testExecutor,
  );
  await delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "The sync outlived the executor; its result is unknown",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  await delivery.requestRecoveryIntent(
    deployment.id,
    {
      requestId: "model/beta/recovery",
      reason: "Re-read the sync operation once ArgoCD settles operation 7",
      expectedGeneration: await generation(database, MODEL_BETA),
      step: "sync",
    },
    testOperator,
  );
}
