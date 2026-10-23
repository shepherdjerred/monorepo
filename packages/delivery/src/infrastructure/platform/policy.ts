import { z } from "zod";
import {
  PLATFORM_POLICY,
  tofuStackPolicy,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { DeliveryError } from "#domain/error.ts";
import {
  PlatformChangesSchema,
  type PipelineDefinition,
  type RegisterEnvironment,
} from "#shared/contract.ts";
import { PlatformSourceSchema } from "#shared/platform-contract.ts";
import { required, fingerprint } from "#infrastructure/delivery-records.ts";
import type { Transaction } from "#infrastructure/delivery-data.ts";

export const RETIRED_ROOT =
  "The root release is retired; per-service environments own their Applications and ordering is a prerequisite edge (X6)";

export function platformPolicyFingerprint() {
  return fingerprint({ policy: PLATFORM_POLICY });
}

export function validatePlatformEnvironment(
  input: Pick<
    RegisterEnvironment,
    "id" | "serviceId" | "application" | "promotionSourceEnvironmentId"
  >,
  definition: PipelineDefinition,
) {
  if (definition.kind === "root-release")
    throw new DeliveryError("INVALID", RETIRED_ROOT);
  if (definition.kind !== "tofu") return;
  if (
    input.serviceId !== "gitops" ||
    input.id !== `gitops/tofu:${definition.stack}` ||
    input.application !== undefined
  )
    throw new DeliveryError(
      "INVALID",
      "Platform pipeline requires its fixed gitops environment and state-stack ownership",
    );
  if (
    ["operator-only", "validate-only"].includes(
      tofuStackPolicy(definition.stack).mode,
    )
  )
    throw new DeliveryError(
      "INVALID",
      "This OpenTofu stack retains its existing independent operator or preparation-only workflow",
    );
}

export function requirePlatformOwner(catalog: ServiceIndex, kind: string) {
  if (
    kind !== "tofu-plan" &&
    catalog.catalog.platformDeliveryDelegated !== true
  )
    throw new DeliveryError(
      "INVALID",
      "Platform mutation remains owned by legacy CI until its reviewed source ownership cutover",
    );
}

export async function platformSource(
  tx: Transaction,
  buildId: string,
  repositoryId: number,
) {
  const build = required(
    await tx.build.findUnique({ where: { id: buildId } }),
    "Platform source build",
  );
  if (build.status !== "verified")
    throw new DeliveryError(
      "CONFLICT",
      "Platform source is awaiting genuine main CI qualification",
    );
  if (
    build.sourceKind !== "ci" ||
    build.repositoryId !== repositoryId ||
    build.serviceId !== "gitops"
  )
    throw new DeliveryError(
      "INVALID",
      "Platform source must be its original qualified gitops main CI build from the canonical repository",
    );
  const source = PlatformSourceSchema.parse({
    id: build.id,
    sourceRevision: build.sourceRevision,
    repositoryId: build.repositoryId,
    pipelineNumber: build.pipelineNumber,
    ciUrl: build.ciUrl,
  });
  const changes =
    build.platformChanges === null
      ? null
      : PlatformChangesSchema.parse(build.platformChanges);
  return { source, changes };
}

export function nativeReceipt(message: string): unknown {
  try {
    return JSON.parse(message) as unknown;
  } catch {
    return null;
  }
}

export const PlatformAcceptanceSchema = z
  .object({
    adapter: z.literal("platform"),
    kind: z.enum(["root-release", "tofu-plan", "tofu-apply"]),
    sourceBuildId: z.string().min(1),
    stack: z.string().optional(),
    planDigest: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/u)
      .optional(),
    /** The state serial the apply read back from its deployment marker (T5). */
    stateSerial: z.number().int().nonnegative().optional(),
  })
  .strict();
