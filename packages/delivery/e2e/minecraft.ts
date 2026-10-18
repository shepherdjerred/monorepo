import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator, testPublisher } from "#testing/seed.ts";
import {
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "#shared/contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";

/** Only the isolated browser harness calls this real PostgreSQL seed. No production fallback exists. */
export async function seedMinecraftRecovery(
  delivery: Delivery,
  chartArtifactId: string,
) {
  const directory = new URL(
    "../registrations/specialized/minecraft-tsmc/",
    import.meta.url,
  );
  const registration = RegisterEnvironmentSchema.parse(
    await Bun.file(new URL("environment.json", directory)).json(),
  );
  const pipeline = PipelineDefinitionSchema.parse(
    await Bun.file(new URL("pipeline.json", directory)).json(),
  );
  const build = await delivery.publish(
    {
      requestId: "browser/minecraft/ci",
      serviceId: "minecraft",
      sourceRevision: "b".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/2",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "browser/minecraft/image",
          component: "image:the-storm-server",
          kind: "image",
          uri: "docker.io/shepherdjerred/the-storm-server",
          version: "browser-candidate",
          digest: `sha256:${"b".repeat(64)}`,
        },
      ],
      retainedArtifactIds: [chartArtifactId],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 2 },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const [version] = await delivery.versions("minecraft");
  if (version === undefined)
    throw new Error("Browser fixture did not produce a qualified version");
  await delivery.registerPipeline(
    registration.pipelineRevisionId,
    pipeline,
    testOperator,
  );
  const environment = await delivery.registerEnvironment(
    registration,
    testOperator,
  );
  const selected = await delivery.createDeployment(
    {
      requestId: "browser/minecraft/deploy",
      environmentId: environment.id,
      expectedGeneration: environment.generation,
      kind: "deploy",
      versionSetRevisionId: version.id,
    },
    testOperator,
  );
  const claimed = await delivery.claim(selected.id, testExecutor);
  await delivery.stage(
    selected.id,
    {
      key: "minecraft-preservation-1",
      operationId: deliveryOperationId(`${selected.id}:minecraft-preservation`),
      status: "succeeded",
      message:
        "Local browser fixture: preservation completed before source selection",
      evidence: [],
    },
    testExecutor,
  );
  await delivery.finish(
    selected.id,
    {
      status: "failed",
      message: "Local fixture: executor interrupted before source selection",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  await delivery.requestMinecraftRecovery(
    selected.id,
    {
      requestId: "browser/minecraft/recovery",
      expectedEnvironmentGeneration: claimed.environment.generation,
      reason:
        "Inspect and recover the unchanged original before selecting the candidate",
    },
    testOperator,
  );
}
