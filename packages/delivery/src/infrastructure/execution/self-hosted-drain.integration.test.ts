import { expect, test } from "vitest";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import {
  arcadePipeline,
  arcadeRegistration,
  publishCiRunner,
  requestOnProd,
} from "#testing/model-fixture.ts";
import { publishVerifiedSet } from "#testing/published-set.ts";
import { testExecutor, testOperator } from "#testing/seed.ts";
import { registerTestService } from "#testing/services.ts";
import {
  requestStackDeployment,
  savedStackPlan,
  startStackPlan,
} from "#testing/tofu-stack-fixture.ts";

const context = useDeliveryFixture({ registration: arcadeRegistration });

async function registerNamedApp(
  serviceId: string,
  appName: string,
  options: {
    pipelineNumber: number;
    recipeOverride?: (
      base: ReturnType<typeof recipeFromPipeline>,
    ) => Record<string, unknown>;
  },
) {
  const db = context.cluster.database;
  await registerTestService(db, serviceId);
  const base = recipeFromPipeline(arcadePipeline);
  if (base.kind !== "kubernetes-application")
    throw new Error("Expected kubernetes-application recipe");
  const renamed = {
    ...base,
    application: {
      ...base.application,
      name: appName,
      source:
        "chart" in base.application.source
          ? { ...base.application.source, chart: appName }
          : base.application.source,
    },
    chartComponent: `chart:${appName}` as const,
    artifactParameters: {},
    steps: base.steps.map((step) => ({
      ...step,
      instance: `application:${appName}`,
    })),
    oracle: { ...base.oracle, monitor: undefined },
  };
  const definition = RecipeDefinitionSchema.parse(
    options.recipeOverride === undefined
      ? renamed
      : options.recipeOverride(renamed),
  );
  const envId = `${serviceId}/prod`;
  await db.pipeline.create({ data: { id: `${serviceId}/1`, definition } });
  await db.configuration.create({
    data: { id: `${serviceId}/1`, content: {} },
  });
  await db.environment.create({
    data: {
      id: envId,
      serviceId,
      name: "prod",
      application: appName,
      pipelineRevisionId: `${serviceId}/1`,
      declaredConfigurationId: `${serviceId}/1`,
    },
  });
  const { set } = await publishVerifiedSet(context, {
    serviceId,
    pipelineNumber: options.pipelineNumber,
    sourceRevision: options.pipelineNumber.toString(16).padStart(40, "0"),
    artifacts: [
      {
        id: `${serviceId}/chart`,
        component: `chart:${appName}`,
        kind: "chart",
        uri: Object.values(context.fixture.versionSet.components)[0]!.uri,
        version: "1.0.0",
        digest: `sha256:${options.pipelineNumber.toString(16).padStart(64, "0")}`,
      },
    ],
  });
  return { envId, set };
}

test("ordinary queued claims pause for an admissible queued self-hosted release while in-flight work finishes, and human-gated waiters do not starve it (AI-572)", async () => {
  await publishCiRunner(context.delivery);
  const db = context.cluster.database;
  await db.pipeline.create({
    data: {
      id: "arcade/model",
      definition: recipeFromPipeline(arcadePipeline),
    },
  });
  await db.environment.update({
    where: { id: "arcade/prod" },
    data: { pipelineRevisionId: "arcade/model", automatic: false },
  });

  // 1. An ordinary deployment (arcade/prod) is actively running.
  const inFlight = await requestOnProd(context, "deploy");
  await context.delivery.claim(inFlight.id, testExecutor);

  // 2. A tofu stack is parked at step-approve awaiting a human saved-plan decision.
  const { deployment: parkedTofu, buildId } =
    await requestStackDeployment(context);
  await startStackPlan(context, parkedTofu.id);
  const plan = savedStackPlan(parkedTofu.id, buildId);
  await context.delivery.recordTofuPlan(plan, testExecutor);
  await context.delivery.stage(
    parkedTofu.id,
    {
      key: "step-plan",
      status: "succeeded",
      operationId: plan.receipt.nativeJob.name,
      message: JSON.stringify(plan.receipt.nativeJob),
      evidence: [],
    },
    testExecutor,
  );
  await context.delivery.stage(
    parkedTofu.id,
    {
      key: "step-approve",
      status: "running",
      operationId: parkedTofu.id,
      message: "step-approve: running",
      evidence: [],
    },
    testExecutor,
  );

  // 3. An operator-run deployment is parked at step-attestation awaiting operator attestations.
  const operatorApp = await registerNamedApp("delivery-data", "delivery-data", {
    pipelineNumber: 92,
    recipeOverride: (wrapped) => ({
      kind: "operator-run",
      wrapped,
      stages: ["apply-safety", "sync"],
    }),
  });
  const parkedOperator = await context.delivery.createDeployment(
    {
      requestId: "operator-run/parked",
      environmentId: operatorApp.envId,
      versionSetRevisionId: operatorApp.set.id,
      expectedGeneration: 0,
      kind: "operator-run",
    },
    testOperator,
  );
  await context.delivery.claim(parkedOperator.id, testExecutor);
  await context.delivery.stage(
    parkedOperator.id,
    {
      key: "step-attestation",
      status: "running",
      operationId: parkedOperator.id,
      message: "step-attestation: running",
      evidence: [],
    },
    testExecutor,
  );

  // 4. Queue both a self-hosted release (delivery-control-plane/prod) and a new ordinary release (birmel/prod).
  const controlPlaneEnv = await registerNamedApp(
    "delivery-control-plane",
    "delivery-control-plane",
    { pipelineNumber: 93 },
  );
  const selfHosted = await context.delivery.createDeployment(
    {
      requestId: "self-hosted/drain",
      environmentId: controlPlaneEnv.envId,
      versionSetRevisionId: controlPlaneEnv.set.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );

  const ordinaryEnv = await registerNamedApp("birmel", "birmel", {
    pipelineNumber: 94,
  });
  const queuedOrdinary = await context.delivery.createDeployment(
    {
      requestId: "ordinary/behind-drain",
      environmentId: ordinaryEnv.envId,
      versionSetRevisionId: ordinaryEnv.set.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );

  // Self-hosted waits ONLY on the active in-flight deployment (arcade/prod), not the human-gated waiters.
  await expect(
    context.delivery.claim(selfHosted.id, testExecutor),
  ).rejects.toMatchObject({
    code: "BUSY",
    message: expect.stringMatching(/arcade\/prod/u),
  });

  // Drain mode refuses the new ordinary queued deployment so running work drains to zero.
  await expect(
    context.delivery.claim(queuedOrdinary.id, testExecutor),
  ).rejects.toMatchObject({
    code: "BUSY",
    message: expect.stringMatching(/draining running work/u),
  });

  // The already-running in-flight deployment still re-claims/fences and finishes cleanly.
  await expect(
    context.delivery.claim(inFlight.id, testExecutor),
  ).resolves.toMatchObject({
    deployment: { id: inFlight.id, status: "running" },
  });
  await context.delivery.finish(
    inFlight.id,
    {
      status: "succeeded",
      message: "Completed in-flight release",
      observedRevisionId: inFlight.versionSetRevisionId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "synced" },
        { kind: "acceptance", summary: "healthy" },
      ],
    },
    testExecutor,
  );

  // Even with step-approve and step-attestation still running, the self-hosted release claims immediately!
  const claimedSelfHosted = await context.delivery.claim(
    selfHosted.id,
    testExecutor,
  );
  expect(claimedSelfHosted.deployment.status).toBe("running");

  await context.delivery.finish(
    selfHosted.id,
    {
      status: "succeeded",
      message: "Self-hosted release completed",
      observedRevisionId: selfHosted.versionSetRevisionId,
      recoveryRequired: false,
      evidence: [
        { kind: "reconciliation", summary: "synced" },
        { kind: "acceptance", summary: "healthy" },
      ],
    },
    testExecutor,
  );

  // Once the self-hosted release finishes, the queued ordinary release claims.
  const claimedOrdinary = await context.delivery.claim(
    queuedOrdinary.id,
    testExecutor,
  );
  expect(claimedOrdinary.deployment.status).toBe("running");
});

test("an inadmissible queued self-hosted deployment does not block the prerequisite it waits on (AI-572)", async () => {
  await publishCiRunner(context.delivery);
  const db = context.cluster.database;
  const prereqEnv = await registerNamedApp("prereq-svc", "prereq-svc", {
    pipelineNumber: 95,
  });
  const selfHostedEnv = await registerNamedApp("temporal", "temporal", {
    pipelineNumber: 96,
  });
  await db.prerequisiteEdge.create({
    data: {
      dependentId: selfHostedEnv.envId,
      prerequisiteId: prereqEnv.envId,
      rule: "any-accepted",
    },
  });

  const selfHosted = await context.delivery.createDeployment(
    {
      requestId: "self-hosted/unmet-prereq",
      environmentId: selfHostedEnv.envId,
      versionSetRevisionId: selfHostedEnv.set.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );
  const prereq = await context.delivery.createDeployment(
    {
      requestId: "prereq/needed-first",
      environmentId: prereqEnv.envId,
      versionSetRevisionId: prereqEnv.set.id,
      expectedGeneration: 0,
      kind: "deploy",
    },
    testOperator,
  );

  await expect(
    context.delivery.claim(selfHosted.id, testExecutor),
  ).rejects.toMatchObject({ code: "BUSY" });

  // Because selfHosted is waiting on prereq-svc/prod, drain mode does not block prereq-svc/prod.
  const claimedPrereq = await context.delivery.claim(prereq.id, testExecutor);
  expect(claimedPrereq.deployment.status).toBe("running");
});
