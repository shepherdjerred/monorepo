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
//
// Golink prod is the second story: its r1 failed, refused by an immutable
// storageClass change its sync recorded as a receipt, and a request for r2
// was queued after it, so the environment refuses a retry of r1.

export const RECOVERY_PROD = "streambot/prod";
const SERVICE = "streambot";
const IMAGE = "docker.io/shepherdjerred/streambot";
/** Golink prod: a failed release with a newer request queued behind it. */
export const HELD_PROD = "golink/prod";
const HELD_SERVICE = "golink";
/**
 * Golink beta: the same refused release with nothing queued behind it, so a
 * spec can request and cancel a newer deployment itself and repeat per project.
 */
export const IDLE_FAILED = "golink/beta";
/**
 * Golink canary: tsmc's shape. Its second deploy ended with two steps still
 * running and a settled recovery that read two Applications back, one naming
 * a phase (Succeeded) and one naming none.
 */
export const INTERRUPTED = "golink/canary";
/** The request id of the canary deploy recovery settled with those readbacks. */
export const INTERRUPTED_REQUEST = "model/golink/canary/interrupted";
/** The Application whose readback names a phase. */
export const READ_BACK_APPLICATION = "golink-canary-companion";
/** The request id of the canary deploy whose apply-safety check threw. */
export const TRACED_REQUEST = "model/golink/canary/refused";
/**
 * What the apply-safety check recorded as evidence: the executor's words, a
 * bundle excerpt run on after them, more excerpt lines, the error's own
 * sentence and its stack frames, as the runtime printed them.
 */
export const APPLY_SAFETY_TRACE = [
  "Apply-safety refused golink at 2.0.0-1018413 before any sync; restored the source Argo last synced (history 44).; 21895 | ${body}`);",
  "21896 | }",
  "21897 | const managed = ManagedResourcesSchema.parse(",
  "error: Refusing golink sync because the read-only apply-safety preflight found:",
  "- acid.zalan.do/postgresql golink/golink-postgresql changes /spec/volume/storageClass from zfs-ssd to zfs-ssd-lz4",
  "      at assertApplySafe (/app/packages/temporal/dist/delivery-argocd.js:21900:11)",
  "      at async main (/app/packages/temporal/dist/delivery-argocd.js:23688:30)",
].join("\n");
/** The request id of the refused deploy on Golink beta. */
export const IDLE_FAILED_REQUEST = "model/golink/beta/refused";
/** The request id of the r1 deploy the storageClass change refused. */
export const REFUSED_REQUEST = "model/golink/refused";
/** What the refused sync recorded, as the page must say it. */
export const REFUSAL = "storageClass zfs-ssd to zfs-ssd-lz4 is immutable";

/** A service and its prod environment, as the seeds publish to and request from them. */
type Target = { service: string; environment: string; image: string };
const STREAMBOT: Target = {
  service: SERVICE,
  environment: RECOVERY_PROD,
  image: IMAGE,
};
const GOLINK: Target = {
  service: HELD_SERVICE,
  environment: HELD_PROD,
  image: "docker.io/shepherdjerred/golink",
};
const GOLINK_BETA: Target = { ...GOLINK, environment: IDLE_FAILED };
const GOLINK_CANARY: Target = { ...GOLINK, environment: INTERRUPTED };
/** The request id of the r4 deploy whose sync recovery read back as Succeeded. */
export const APPLIED_REQUEST = "model/streambot/applied";
/** The request id of the r2 deploy r3's acceptance superseded. */
export const SUPERSEDED_REQUEST = "model/streambot/superseded";

/** The image digest release `n` of Streambot selects. */
const digest = (n: number) => `sha256:${String(n + 4).repeat(64)}`;
/** The image ArgoCD reports running for Streambot: r4's, which recovery read back as applied. */
export const RECOVERY_LIVE_IMAGE = `${IMAGE}@${digest(4)}`;

/** Golink's recipe for another environment, whose Application and instance are its own (T6). */
function golinkRecipe(suffix: string) {
  const recipe = applicationRecipe(HELD_SERVICE);
  const name = `${HELD_SERVICE}-${suffix}`;
  return {
    ...recipe,
    application: {
      ...recipe.application,
      name,
      destination: { ...recipe.application.destination, namespace: name },
    },
    steps: recipe.steps.map((entry) => ({
      ...entry,
      instance: `application:${name}`,
    })),
  };
}

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
      {
        id: HELD_SERVICE,
        title: "Golink",
        lifecycle: "active",
        selfHosted: false,
        group: "ci",
        components: [
          { name: "image:golink", producer: "first-party" },
          { name: "chart:golink", producer: "first-party" },
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
      ...[HELD_PROD, IDLE_FAILED, INTERRUPTED].map((id, index) => ({
        id,
        role: "durable",
        approvalPolicy: "none",
        automatic: false,
        recipeRevisionId: `golink/${String(index + 1)}`,
        configurationRevisionId: "golink/1",
      })),
    ],
    recipes: [
      ...document.recipes,
      { id: "streambot/1", definition: applicationRecipe(SERVICE) },
      { id: "golink/1", definition: applicationRecipe(HELD_SERVICE) },
      { id: "golink/2", definition: golinkRecipe("beta") },
      { id: "golink/3", definition: golinkRecipe("canary") },
    ],
    configurations: [
      ...document.configurations,
      { id: "streambot/1", content: {}, forwardOnly: [] },
      { id: "golink/1", content: {}, forwardOnly: [] },
    ],
  };
}

/** Publish Streambot release `n` and return its composed set revision. */
async function publish(
  delivery: Delivery,
  database: Database,
  n: number,
  target = STREAMBOT,
) {
  const tag = String(n);
  const { service } = target;
  const build = await delivery.publish(
    {
      requestId: `model/${service}/publish/${tag}`,
      serviceId: service,
      sourceRevision: `5${tag}`.repeat(20),
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(300 + n)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `model/${service}/image/${tag}`,
          component: `image:${service}`,
          kind: "image",
          uri: target.image,
          version: `2.${tag}.0`,
          digest: digest(n),
        },
        {
          id: `model/${service}/chart/${tag}`,
          component: `chart:${service}`,
          kind: "chart",
          uri: `https://charts.tailnet-1a49.ts.net/charts/${service}-2.${tag}.0.tgz`,
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
    where: { serviceId: service },
    orderBy: { revision: "desc" },
  });
  return newest.id;
}

/** A deploy of `setId` to a target's prod (Streambot's unless it names another). */
type Request = { requestId: string; setId: string; target?: Target };

/** Request a deploy to the target's prod and claim it, as dispatch does. */
async function start(delivery: Delivery, database: Database, input: Request) {
  const deployment = await request(delivery, database, input);
  await delivery.claim(deployment.id, testExecutor);
  return deployment;
}

/** Request a deploy to the target's prod and leave it queued. */
async function request(
  delivery: Delivery,
  database: Database,
  { requestId, setId, target = STREAMBOT }: Request,
) {
  const env = await database.environment.findUniqueOrThrow({
    where: { id: target.environment },
  });
  return await delivery.createDeployment(
    {
      requestId,
      environmentId: target.environment,
      expectedGeneration: env.generation,
      kind: "deploy",
      versionSetRevisionId: setId,
    },
    testOperator,
  );
}

/** Record one step of the recipe: apply-safety or sync. */
async function step(
  delivery: Delivery,
  deploymentId: string,
  key: "step-apply-safety" | "step-sync",
  outcome:
    | "running"
    | "succeeded"
    | "failed"
    | { status: "failed"; message: string; evidence?: string },
) {
  const { status, message, evidence } =
    typeof outcome === "string"
      ? { status: outcome, message: `${key}: ${outcome}`, evidence: undefined }
      : outcome;
  await delivery.stage(
    deploymentId,
    {
      key,
      status,
      operationId: `${deploymentId}/request`,
      message,
      evidence:
        evidence === undefined
          ? []
          : [{ kind: "preflight" as const, summary: evidence }],
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
  const deployment = await start(delivery, database, { requestId, setId });
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
  const deployment = await start(delivery, database, { requestId, setId });
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
  await settleInterrupted(
    delivery,
    database,
    { requestId: APPLIED_REQUEST, setId },
    {
      running: ["step-sync"],
      readbacks: (deploymentId) => [
        `Independent Application readback: streambot, resourceVersion 330545892, request ${deploymentId}/request, operation 9, phase Succeeded, finished 2026-11-22T08:14:30Z`,
      ],
    },
  );
}

/** What a deploy ended on: the steps still running, and the readbacks recovery then recorded. */
type Interruption = {
  running: ("step-apply-safety" | "step-sync")[];
  readbacks: (deploymentId: string) => string[];
};

/**
 * A deploy that ended with `running` steps still running and recovery
 * required, then settled by an independent readback that recorded the
 * `readbacks` it names.
 */
async function settleInterrupted(
  delivery: Delivery,
  database: Database,
  input: Request,
  { running, readbacks }: Interruption,
) {
  const { target = STREAMBOT } = input;
  const deployment = await start(delivery, database, input);
  for (const key of running)
    await step(delivery, deployment.id, key, "running");
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
    where: { id: target.environment },
  });
  const intent = await delivery.requestRecoveryIntent(
    deployment.id,
    {
      requestId: `${input.requestId}/recovery`,
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
    readbacks(deployment.id).map((summary) => ({
      kind: "reconciliation" as const,
      operationId: `${deployment.id}/operation-9`,
      summary,
    })),
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

/**
 * Golink prod's history: its r1 sync was refused because the chart changes an
 * immutable storageClass, and the failure recorded that as a receipt behind
 * the executor's generic message; then r2 was requested and is still queued.
 */
export async function seedHeldRetry(delivery: Delivery, database: Database) {
  const first = await publish(delivery, database, 1, GOLINK);
  await refuse(delivery, database, {
    requestId: REFUSED_REQUEST,
    setId: first,
    target: GOLINK,
  });
  const second = await publish(delivery, database, 2, GOLINK);
  await request(delivery, database, {
    requestId: "model/golink/queued",
    setId: second,
    target: GOLINK,
  });
  // Beta's refused release has nothing queued behind it.
  await refuse(delivery, database, {
    requestId: IDLE_FAILED_REQUEST,
    setId: await publish(delivery, database, 3, GOLINK),
    target: GOLINK_BETA,
  });
  // Canary failed twice: an apply-safety check that threw, then a deploy that
  // ended mid-step.
  await throwInApplySafety(delivery, database, {
    requestId: TRACED_REQUEST,
    setId: await publish(delivery, database, 4, GOLINK),
    target: GOLINK_CANARY,
  });
  await settleInterrupted(
    delivery,
    database,
    {
      requestId: INTERRUPTED_REQUEST,
      setId: await publish(delivery, database, 5, GOLINK),
      target: GOLINK_CANARY,
    },
    {
      running: ["step-apply-safety", "step-sync"],
      readbacks: (deploymentId) => [
        `Independent Application readback: ${READ_BACK_APPLICATION}, resourceVersion 7, request ${deploymentId}/other-request, operation 3, phase Succeeded, finished 2026-11-22T08:14:30Z`,
        "Independent Application readback: golink-canary, resourceVersion 8, no operation recorded",
      ],
    },
  );
}

/** A deploy whose sync the executor ended failed, with the refusal as a receipt. */
async function refuse(delivery: Delivery, database: Database, input: Request) {
  const refused = await start(delivery, database, input);
  await step(delivery, refused.id, "step-apply-safety", "succeeded");
  await step(delivery, refused.id, "step-sync", {
    status: "failed",
    message: JSON.stringify({ adapter: "argo", refused: REFUSAL }),
  });
  await delivery.finish(
    refused.id,
    {
      status: "failed",
      message:
        "Deployment stopped; inspect Workflow history and recorded evidence",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
}

/** A deploy whose apply-safety check threw, recording the error as the runtime printed it. */
async function throwInApplySafety(
  delivery: Delivery,
  database: Database,
  input: Request,
) {
  const thrown = await start(delivery, database, input);
  await step(delivery, thrown.id, "step-apply-safety", {
    status: "failed",
    message: "step-apply-safety: failed",
    evidence: APPLY_SAFETY_TRACE,
  });
  await delivery.finish(
    thrown.id,
    {
      status: "failed",
      message: "Deployment stopped",
      recoveryRequired: false,
      evidence: [],
    },
    testExecutor,
  );
}
