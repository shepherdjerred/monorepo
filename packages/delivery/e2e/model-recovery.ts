import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { applicationRecipe } from "#testing/catalog-fixture.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";

// Streambot prod as release r325 found it, recorded through Delivery's own
// publication, request, execution and recovery APIs: r1 accepted; r2
// failed and r3 accepted after it, superseding it; then r4 failed twice in
// a row, the second time with its sync outliving the executor, until an
// independent readback settled that sync as Succeeded. Nothing accepted r4,
// and ArgoCD reports r4's image running.

export const RECOVERY_PROD = "streambot/prod";
const SERVICE = "streambot";
const IMAGE = "docker.io/shepherdjerred/streambot";
/** The request id of the r4 deploy whose sync recovery read back as Succeeded. */
export const APPLIED_REQUEST = "model/streambot/applied";
/** The request id of the r2 deploy r3's acceptance superseded. */
export const SUPERSEDED_REQUEST = "model/streambot/superseded";

/** The image digest release `n` of Streambot selects. */
const digest = (n: number) => `sha256:${String(n + 4).repeat(64)}`;
/** The image ArgoCD reports running for Streambot: r4's, which recovery read back as applied. */
export const RECOVERY_LIVE_IMAGE = `${IMAGE}@${digest(4)}`;

type Catalog = {
  services: unknown[];
  environments: unknown[];
  recipes: unknown[];
  configurations: unknown[];
};

/** The catalog document with Streambot, its prod environment and its recipe. */
export function withRecovery<T extends Catalog>(document: T): T {
  return {
    ...document,
    services: [
      ...document.services,
      {
        id: SERVICE,
        title: "Streambot",
        lifecycle: "active",
        selfHosted: false,
        group: "ci",
        components: [
          { name: "image:streambot", producer: "first-party" },
          { name: "chart:streambot", producer: "first-party" },
        ],
      },
    ],
    environments: [
      ...document.environments,
      {
        id: RECOVERY_PROD,
        role: "durable",
        approvalPolicy: "none",
        automatic: false,
        recipeRevisionId: "streambot/1",
        configurationRevisionId: "streambot/1",
      },
    ],
    recipes: [
      ...document.recipes,
      { id: "streambot/1", definition: applicationRecipe(SERVICE) },
    ],
    configurations: [
      ...document.configurations,
      { id: "streambot/1", content: {}, forwardOnly: [] },
    ],
  };
}

/** Publish Streambot release `n` and return its composed set revision. */
async function publish(delivery: Delivery, database: Database, n: number) {
  const tag = String(n);
  const build = await delivery.publish(
    {
      requestId: `model/streambot/publish/${tag}`,
      serviceId: SERVICE,
      sourceRevision: `5${tag}`.repeat(20),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(300 + n)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `model/streambot/image/${tag}`,
          component: "image:streambot",
          kind: "image",
          uri: IMAGE,
          version: `2.${tag}.0`,
          digest: digest(n),
        },
        {
          id: `model/streambot/chart/${tag}`,
          component: "chart:streambot",
          kind: "chart",
          uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/streambot-2.${tag}.0.tgz`,
          version: `2.${tag}.0`,
          digest: `sha256:${String(n).repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 300 + n },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const newest = await database.versionSet.findFirstOrThrow({
    where: { serviceId: SERVICE },
    orderBy: { revision: "desc" },
  });
  return newest.id;
}

/** Request a deploy of `setId` to Streambot prod and claim it, as dispatch does. */
async function start(
  delivery: Delivery,
  database: Database,
  requestId: string,
  setId: string,
) {
  const env = await database.environment.findUniqueOrThrow({
    where: { id: RECOVERY_PROD },
  });
  const deployment = await delivery.createDeployment(
    {
      requestId,
      environmentId: RECOVERY_PROD,
      expectedGeneration: env.generation,
      kind: "deploy",
      versionSetRevisionId: setId,
    },
    testOperator,
  );
  await delivery.claim(deployment.id, testExecutor);
  return deployment;
}

/** Record one step of the recipe: apply-safety or sync. */
async function step(
  delivery: Delivery,
  deploymentId: string,
  key: "step-apply-safety" | "step-sync",
  status: "running" | "succeeded" | "failed",
) {
  await delivery.stage(
    deploymentId,
    {
      key,
      status,
      operationId: `${deploymentId}/request`,
      message: `${key}: ${status}`,
      evidence: [],
    },
    testExecutor,
  );
}

/** A deploy whose sync completes and is accepted. */
async function accept(
  delivery: Delivery,
  database: Database,
  requestId: string,
  setId: string,
) {
  const deployment = await start(delivery, database, requestId, setId);
  await step(delivery, deployment.id, "step-apply-safety", "succeeded");
  await step(delivery, deployment.id, "step-sync", "succeeded");
  await delivery.finish(
    deployment.id,
    {
      status: "succeeded",
      message: "Release accepted",
      observedRevisionId: setId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "exact operation completed" },
        { kind: "acceptance", summary: "acceptance checks passed" },
      ],
    },
    testExecutor,
  );
}

/** A deploy whose sync failed outright. */
async function fail(
  delivery: Delivery,
  database: Database,
  requestId: string,
  setId: string,
) {
  const deployment = await start(delivery, database, requestId, setId);
  await step(delivery, deployment.id, "step-apply-safety", "succeeded");
  await step(delivery, deployment.id, "step-sync", "failed");
  await delivery.finish(
    deployment.id,
    {
      status: "failed",
      message: "Sync timed out waiting for the Application to become healthy",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
}

/**
 * A deploy whose sync outlived its executor, then settled by an independent
 * Application readback that found the operation Succeeded (4.15).
 */
async function settleApplied(
  delivery: Delivery,
  database: Database,
  setId: string,
) {
  const deployment = await start(delivery, database, APPLIED_REQUEST, setId);
  await step(delivery, deployment.id, "step-apply-safety", "succeeded");
  await step(delivery, deployment.id, "step-sync", "running");
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
  const env = await database.environment.findUniqueOrThrow({
    where: { id: RECOVERY_PROD },
  });
  const intent = await delivery.requestRecoveryIntent(
    deployment.id,
    {
      requestId: `${APPLIED_REQUEST}/recovery`,
      reason:
        "Opened automatically: the deployment ended recovery-required and its independent reader decides",
      expectedGeneration: env.generation,
    },
    testOperator,
  );
  await delivery.settleArgoIntent(
    intent.id,
    "Settled automatically by independent Application readback of the finished operation",
    testOperator,
    [
      {
        kind: "reconciliation",
        operationId: `${deployment.id}/operation-9`,
        summary: `Independent Application readback: streambot, resourceVersion 330545892, request ${deployment.id}/request, operation 9, phase Succeeded, finished 2026-11-22T08:14:30Z`,
      },
    ],
  );
}

/** Streambot prod's history as release r325 found it. */
export async function seedRecovery(delivery: Delivery, database: Database) {
  // Each release is published just before it is requested.
  const release = (n: number) => publish(delivery, database, n);
  await accept(delivery, database, "model/streambot/first", await release(1));
  await fail(delivery, database, SUPERSEDED_REQUEST, await release(2));
  await accept(delivery, database, "model/streambot/third", await release(3));
  const fourth = await release(4);
  await fail(delivery, database, "model/streambot/fourth", fourth);
  await settleApplied(delivery, database, fourth);
}
