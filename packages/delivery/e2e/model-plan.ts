import type { Database } from "#infrastructure/database.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";

// The non-application recipe kinds (section 5), recorded through Delivery's
// own publication, request and stage APIs: Cloudflare's tofu approve step
// waits for a human, Argo CD's operator-run recipe waits for an attested
// stage, and a channel recipe publishes Arcade's client package.

export const STACK_PROD = "tofu-cloudflare/prod";
export const OPERATOR_PROD = "tofu-argocd/prod";
export const CHANNEL_PROD = "arcade-client/prod";
const CHANNEL = "arcade-client";
const CHANNEL_ARCHIVE = "archive:arcade-client";
const STACK = "tofu-cloudflare";
const ARCHIVE = "archive:tofu-cloudflare";
const OPERATOR = "tofu-argocd";
const OPERATOR_ARCHIVE = "archive:tofu-argocd";

/** A tofu recipe body over one stack's archive. */
function tofu(stack: string, archiveComponent: string) {
  return {
    kind: "tofu",
    stack,
    archiveComponent,
    runner: { service: "ci", component: "image:ci-base" },
    steps: ["plan", "approve", "apply"].map((kind) => ({
      kind,
      instance: `stack:${stack}`,
    })),
    sharedLock: "platform",
  };
}

type Catalog = {
  services: unknown[];
  environments: unknown[];
  recipes: unknown[];
  configurations: unknown[];
};

const service = (id: string, title: string, archive: string) => ({
  id,
  title,
  lifecycle: "active",
  selfHosted: false,
  group: "ci",
  components: [{ name: archive, producer: "first-party" }],
});
const environment = (id: string, recipe: string) => ({
  id,
  role: "durable",
  approvalPolicy: "none",
  automatic: false,
  recipeRevisionId: recipe,
  configurationRevisionId: recipe,
});

/** The catalog document with the two stacks, their environments and recipes. */
export function withStack<T extends Catalog>(document: T): T {
  return {
    ...document,
    services: [
      ...document.services,
      service(STACK, "Cloudflare", ARCHIVE),
      service(OPERATOR, "Argo CD stack", OPERATOR_ARCHIVE),
      service(CHANNEL, "Arcade client", CHANNEL_ARCHIVE),
    ],
    environments: [
      ...document.environments,
      environment(STACK_PROD, `${STACK}/1`),
      environment(OPERATOR_PROD, `${OPERATOR}/1`),
      environment(CHANNEL_PROD, `${CHANNEL}/1`),
    ],
    recipes: [
      ...document.recipes,
      { id: `${STACK}/1`, definition: tofu("cloudflare", ARCHIVE) },
      {
        id: `${OPERATOR}/1`,
        definition: {
          kind: "operator-run",
          wrapped: tofu("argocd", OPERATOR_ARCHIVE),
          stages: ["apply"],
        },
      },
      {
        id: `${CHANNEL}/1`,
        definition: {
          kind: "channel",
          store: "npm",
          name: "@shepherdjerred/arcade-client",
          pointer: "latest",
          forwardOnly: false,
          artifactComponent: CHANNEL_ARCHIVE,
        },
      },
    ],
    configurations: [
      ...document.configurations,
      { id: `${STACK}/1`, content: {}, forwardOnly: [] },
      { id: `${OPERATOR}/1`, content: {}, forwardOnly: [] },
      { id: `${CHANNEL}/1`, content: {}, forwardOnly: [] },
    ],
  };
}

const native = {
  namespace: "delivery-platform-jobs" as const,
  name: `delivery-${"9".repeat(40)}`,
  uid: "33333333-3333-4333-8333-333333333333",
  specFingerprint: "f".repeat(64),
};

/** Publish one stack's archive as a qualified, composed set revision. */
async function publishStack(
  delivery: Delivery,
  stack: { service: string; archive: string },
  seed: string,
) {
  const revision = seed.repeat(40);
  const pipeline = 190 + stack.service.length;
  const build = await delivery.publish(
    {
      requestId: `model/publish/${stack.service}`,
      serviceId: stack.service,
      sourceRevision: revision,
      ciUrl: `https://woodpecker.sjer.red/repos/1/pipeline/${String(pipeline)}`,
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: `model/${stack.service}/archive`,
          component: stack.archive,
          kind: "archive",
          uri: `s3://delivery-artifacts/tofu/${stack.service}/${seed.repeat(64)}.tar`,
          version: revision,
          digest: `sha256:${seed.repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: pipeline },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const [set] = await delivery.versions(stack.service);
  if (set === undefined) throw new Error("The stack archive composed no set");
  return { setId: set.id, buildId: build.buildId, revision };
}

/** The Argo CD stack's and Arcade client's archives, ready for their requests. */
export async function seedOperatorRun(delivery: Delivery) {
  await publishStack(
    delivery,
    { service: OPERATOR, archive: OPERATOR_ARCHIVE },
    "d",
  );
  await publishStack(
    delivery,
    { service: CHANNEL, archive: CHANNEL_ARCHIVE },
    "e",
  );
}

/** Publish the Cloudflare archive, request it, and run the plan step to the approval it waits on. */
export async function seedWaitingPlan(delivery: Delivery, database: Database) {
  const { setId, buildId, revision } = await publishStack(
    delivery,
    { service: STACK, archive: ARCHIVE },
    "c",
  );
  const env = await database.environment.findUniqueOrThrow({
    where: { id: STACK_PROD },
  });
  const deployment = await delivery.createDeployment(
    {
      requestId: "model/tofu-cloudflare/request",
      environmentId: STACK_PROD,
      versionSetRevisionId: setId,
      expectedGeneration: env.generation,
      kind: "deploy",
    },
    testOperator,
  );
  await delivery.claim(deployment.id, testExecutor);
  const job = { ...native, requestId: deployment.id };
  await delivery.stage(
    deployment.id,
    {
      key: "step-plan",
      status: "running",
      operationId: native.name,
      message: JSON.stringify(job),
      evidence: [],
    },
    testExecutor,
  );
  const now = Date.now();
  const receipt = {
    schema: "delivery-tofu-plan/v1" as const,
    deploymentId: deployment.id,
    sourceBuildId: buildId,
    sourceRevision: revision,
    stack: "cloudflare" as const,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
    planDigest: `sha256:${"7".repeat(64)}`,
    state: { lineage: "cloudflare-state", serial: 41 },
    nativeJob: job,
    changes: { create: 2, update: 1, delete: 0, replace: 0 },
  };
  await delivery.recordTofuPlan(
    {
      receipt,
      encryptedPlan: {
        algorithm: "aes-256-gcm" as const,
        salt: btoa("s".repeat(16)),
        iv: btoa("i".repeat(12)),
        tag: btoa("t".repeat(16)),
        ciphertext: btoa("plan"),
      },
    },
    testExecutor,
  );
  await delivery.stage(
    deployment.id,
    {
      key: "step-plan",
      status: "succeeded",
      operationId: native.name,
      message: JSON.stringify(job),
      evidence: [
        {
          kind: "preflight",
          operationId: native.uid,
          summary: JSON.stringify({
            adapter: "tofu",
            step: "plan",
            stack: "cloudflare",
            planDigest: receipt.planDigest,
            changes: receipt.changes,
          }),
        },
      ],
    },
    testExecutor,
  );
  await delivery.stage(
    deployment.id,
    {
      key: "step-approve",
      status: "running",
      operationId: `${deployment.id}/approve`,
      message: "Waiting for a human approval of the saved plan",
      evidence: [],
    },
    testExecutor,
  );
}
