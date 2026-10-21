import type { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import {
  LegacyPipelineRevisionSchema,
  type Principal,
  type Environment,
} from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { audit, required, wire } from "#infrastructure/delivery-records.ts";
import { environment } from "#infrastructure/delivery-data.ts";

async function blocked(
  this: Delivery,
  environmentId: string,
  error: DeliveryError,
  actor: Principal,
) {
  const existing = await this.database.audit.findFirst({
    where: {
      action: "platform.selection_blocked",
      entityId: environmentId,
      requestId: error.message,
    },
  });
  if (existing === null)
    await this.database.$transaction((tx) =>
      audit(tx, actor, {
        action: "platform.selection_blocked",
        entityId: environmentId,
        requestId: error.message,
        metadata: { reason: error.message },
      }),
    );
}

async function selectPlatform(
  this: Delivery,
  env: Environment,
  definition: { kind: "tofu"; stack: Parameters<typeof tofuStackPolicy>[0] },
  actor: Principal,
) {
  const source = await this.database.build.findFirst({
    where: {
      serviceId: "gitops",
      sourceKind: "ci",
      status: "verified",
      repositoryId: this.repositoryId,
      platformChanges: {
        path: ["tofuStacks"],
        array_contains: [definition.stack],
      },
    },
    orderBy: [{ pipelineNumber: "desc" }, { createdAt: "desc" }],
  });
  if (source === null) return null;
  const history = await this.database.deployment.findMany({
    where: { environmentId: env.id, platformSourceBuildId: source.id },
    orderBy: { createdAt: "desc" },
  });
  const plan = history.find((row) => row.kind === "tofu-plan");
  if (plan === undefined)
    return this.createPlatformDeployment(
      {
        kind: "tofu-plan",
        requestId: `platform-auto/${env.id}/${source.id}/plan`,
        environmentId: env.id,
        sourceBuildId: source.id,
        expectedGeneration: env.generation,
      },
      actor,
      true,
    );
  if (
    plan.status !== "succeeded" ||
    this.catalog.catalog.platformDeliveryDelegated !== true ||
    history.some((row) => row.kind === "tofu-apply")
  )
    return null;
  return this.createPlatformDeployment(
    {
      kind: "tofu-apply",
      requestId: `platform-auto/${env.id}/${source.id}/apply`,
      environmentId: env.id,
      planDeploymentId: plan.id,
      expectedGeneration: env.generation,
    },
    actor,
    true,
  );
}

export async function reconcilePlatform(
  this: Delivery,
  enabledEnvironments: string[],
  actor: Principal,
) {
  const deployments: string[] = [];
  const waiting: { environmentId: string; reason: string }[] = [];
  for (const row of await this.database.environment.findMany({
    where: { automatic: true, id: { in: enabledEnvironments } },
  })) {
    const pipeline = LegacyPipelineRevisionSchema.parse(
      wire(
        required(
          await this.database.pipeline.findUnique({
            where: { id: row.pipelineRevisionId },
          }),
          "Pipeline",
        ),
      ),
    );
    const definition = pipeline.definition;
    if (definition.kind !== "tofu") continue;
    if (
      row.activeDeploymentId !== null ||
      (await this.database.deployment.count({
        where: {
          environmentId: row.id,
          status: { in: ["queued", "awaiting_approval", "running"] },
        },
      })) !== 0
    )
      continue;
    const env = await environment(this.database, row.id);
    try {
      const selected = await selectPlatform.call(this, env, definition, actor);
      if (selected !== null) deployments.push(selected.id);
    } catch (error) {
      if (!(error instanceof DeliveryError)) throw error;
      waiting.push({ environmentId: env.id, reason: error.message });
      await blocked.call(this, env.id, error, actor);
    }
  }
  return { deployments, waiting };
}
