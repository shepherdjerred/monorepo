import { tofuStackPolicy } from "@shepherdjerred/ops-model/platform-policy.ts";
import { DeliveryError } from "#domain/error.ts";
import type { PlatformChangesSchema } from "#shared/contract.ts";
import {
  PlatformReleaseSnapshotSchema,
  type CreatePlatformDeployment,
  type PlatformReleaseSnapshot,
  type PipelineDefinition,
} from "#shared/contract.ts";
import {
  TofuPlanReceiptSchema,
  type PlatformPrerequisiteSnapshotSchema,
} from "#shared/platform-contract.ts";
import type { z } from "zod";
import type { Transaction } from "#infrastructure/delivery-data.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { required } from "#infrastructure/delivery-records.ts";
import {
  RETIRED_ROOT,
  platformPolicyFingerprint,
  platformSource,
} from "./policy.ts";

type Prerequisite = z.infer<typeof PlatformPrerequisiteSnapshotSchema>;
function prerequisites(
  changes: z.infer<typeof PlatformChangesSchema> | null,
  selected: readonly string[],
  sourceBuildId: string,
): Prerequisite[] {
  return selected.flatMap((dependency): Prerequisite[] => {
    // Only state stacks remain v1 prerequisites; the root inventory and the
    // shared site service are retired (X4, X6) and order through edges.
    if (!dependency.startsWith("tofu:"))
      throw new DeliveryError("INVALID", RETIRED_ROOT);
    const stack = dependency.slice("tofu:".length);
    const match = changes?.tofuStacks.find((entry) => entry === stack);
    if (match === undefined)
      throw new DeliveryError(
        "INVALID",
        `Platform source must include prerequisite ${dependency} in its reviewed operation closure`,
      );
    return [{ kind: "tofu", sourceBuildId, stack: match }];
  });
}

export async function freezePlatformSnapshot(
  tx: Transaction,
  delivery: Delivery,
  input: CreatePlatformDeployment,
  definition: PipelineDefinition,
): Promise<PlatformReleaseSnapshot> {
  if (input.kind === "tofu-apply") {
    if (definition.kind !== "tofu")
      throw new DeliveryError(
        "INVALID",
        "Apply requires its reviewed OpenTofu stack pipeline",
      );
    const stored = required(
      await tx.platformPlan.findUnique({
        where: { deploymentId: input.planDeploymentId },
        include: { deployment: true },
      }),
      "Saved platform plan",
    );
    const plan = TofuPlanReceiptSchema.parse(stored.receipt);
    if (
      stored.deployment.status !== "succeeded" ||
      plan.stack !== definition.stack ||
      stored.deployment.environmentId !== input.environmentId
    )
      throw new DeliveryError(
        "INVALID",
        "Apply must select a successful saved plan for the same immutable stack and environment",
      );
    if (
      stored.applyDeploymentId !== null ||
      Date.parse(plan.expiresAt) <= Date.now()
    )
      throw new DeliveryError(
        "CONFLICT",
        "Saved platform plan has expired or was already claimed for apply; prepare a new plan",
      );
    const prior = PlatformReleaseSnapshotSchema.parse(
      stored.deployment.platformSnapshot,
    );
    const { source, changes } = await platformSource(
      tx,
      plan.sourceBuildId,
      delivery.repositoryId,
    );
    return PlatformReleaseSnapshotSchema.parse({
      kind: input.kind,
      source,
      stack: definition.stack,
      planDeploymentId: input.planDeploymentId,
      plan,
      prerequisites: prerequisites(
        changes,
        tofuStackPolicy(definition.stack).prerequisites,
        source.id,
      ),
      policyFingerprint: prior.policyFingerprint,
    });
  }
  const { source, changes } = await platformSource(
    tx,
    input.sourceBuildId,
    delivery.repositoryId,
  );
  const common = {
    source,
    policyFingerprint: platformPolicyFingerprint(),
  };
  if (definition.kind !== "tofu")
    throw new DeliveryError(
      "INVALID",
      "Plan requires its reviewed OpenTofu stack pipeline",
    );
  if (
    ["operator-only", "validate-only"].includes(
      tofuStackPolicy(definition.stack).mode,
    )
  )
    throw new DeliveryError(
      "INVALID",
      "This stack cannot be automated by Delivery",
    );
  return PlatformReleaseSnapshotSchema.parse({
    kind: input.kind,
    ...common,
    stack: definition.stack,
    prerequisites: prerequisites(
      changes,
      tofuStackPolicy(definition.stack).prerequisites,
      source.id,
    ),
  });
}
