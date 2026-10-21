import {
  PLATFORM_POLICY,
  tofuStackPolicy,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import { DeliveryError } from "#domain/error.ts";
import type { PlatformChangesSchema } from "#shared/contract.ts";
import {
  PlatformReleaseSnapshotSchema,
  type CreatePlatformDeployment,
  type PlatformReleaseSnapshot,
  type PipelineDefinition,
  LegacyPipelineRevisionSchema,
} from "#shared/contract.ts";
import {
  TofuPlanReceiptSchema,
  type PlatformPrerequisiteSnapshotSchema,
} from "#shared/platform-contract.ts";
import type { z } from "zod";
import { artifact, type Transaction } from "#infrastructure/delivery-data.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { required } from "#infrastructure/delivery-records.ts";
import { wire } from "#infrastructure/delivery-records.ts";
import { platformPolicyFingerprint, platformSource } from "./policy.ts";

type Prerequisite = z.infer<typeof PlatformPrerequisiteSnapshotSchema>;
function prerequisites(
  changes: z.infer<typeof PlatformChangesSchema> | null,
  selected: readonly string[],
  sourceBuildId: string,
): Prerequisite[] {
  return selected.flatMap((dependency): Prerequisite[] => {
    if (dependency === "root") {
      if (changes?.root !== true)
        throw new DeliveryError(
          "INVALID",
          "Cloudflare requires an exact same-source root inventory prerequisite",
        );
      return [
        { kind: "root", sourceBuildId, rootArtifacts: changes.rootArtifacts },
      ];
    }
    if (dependency === "static-sites")
      return (
        changes?.sites.map((site) => ({ kind: "site" as const, ...site })) ?? []
      );
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

async function rootCharts(
  tx: Transaction,
  delivery: Delivery,
  references: Record<string, string>,
) {
  const expected = delivery.catalog.rootReleaseCharts();
  if (
    expected.some((entry) =>
      ["temporal", "delivery-control-plane"].includes(entry.name),
    )
  )
    throw new DeliveryError(
      "INVALID",
      "Root platform ownership requires both central Temporal and Delivery control-plane application delegation first; controller templates cannot bypass independent ownership",
    );
  const names = Object.keys(references).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify(expected.map((entry) => entry.name))
  )
    throw new DeliveryError(
      "INVALID",
      "Root release requires the complete reviewed active first-party chart inventory, excluding delegated and upstream owners",
    );
  const charts = [];
  for (const { name, serviceId } of expected) {
    const selected = await artifact(
      tx,
      required(references[name] ?? null, "Original root chart reference"),
    );
    const build = await tx.build.findUniqueOrThrow({
      where: { id: selected.buildId },
    });
    if (
      selected.serviceId !== serviceId ||
      selected.kind !== "chart" ||
      selected.component !== `chart:${name}` ||
      selected.origin.kind !== "first-party" ||
      build.sourceKind !== "ci" ||
      build.repositoryId !== delivery.repositoryId ||
      !/^2\.0\.0-\d+$/u.test(selected.version) ||
      selected.uri !==
        `https://chartmuseum.tailnet-1a49.ts.net/charts/${name}-${selected.version}.tgz`
    )
      throw new DeliveryError(
        "INVALID",
        "Root inventory must retain each exact original qualified first-party chart and canonical catalog owner",
      );
    charts.push({ name, artifact: selected });
  }
  return charts;
}

async function rootSiteArtifacts(
  tx: Transaction,
  changes: z.infer<typeof PlatformChangesSchema> | null,
  repositoryId: number,
) {
  const entries: Record<string, string> = {};
  for (const site of changes?.sites ?? []) {
    const env = required(
      await tx.environment.findUnique({ where: { id: site.environmentId } }),
      "Reviewed root site environment",
    );
    const pipeline = LegacyPipelineRevisionSchema.parse(
      wire(
        required(
          await tx.pipeline.findUnique({
            where: { id: env.pipelineRevisionId },
          }),
          "Reviewed root site pipeline",
        ),
      ),
    );
    const selected = await artifact(tx, site.artifactId);
    const producer = await tx.build.findUniqueOrThrow({
      where: { id: selected.buildId },
    });
    if (
      pipeline.definition.kind !== "static-site" ||
      selected.kind !== "archive" ||
      selected.serviceId !== "static-sites" ||
      producer.sourceKind !== "ci" ||
      producer.repositoryId !== repositoryId ||
      selected.component !== pipeline.definition.archiveComponent
    )
      throw new DeliveryError(
        "INVALID",
        "Root site bindings require each reviewed independent site's exact original qualified archive",
      );
    entries[site.environmentId] = site.artifactId;
  }
  return entries;
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
    policyFingerprint: platformPolicyFingerprint(delivery.catalog),
  };
  if (input.kind === "root-release") {
    if (definition.kind !== "root-release")
      throw new DeliveryError(
        "INVALID",
        "Root release requires its reviewed root pipeline",
      );
    const references = input.rootArtifacts ?? changes?.rootArtifacts;
    if (references === undefined)
      throw new DeliveryError(
        "INVALID",
        "Root release requires exact original chart artifact IDs",
      );
    return PlatformReleaseSnapshotSchema.parse({
      kind: input.kind,
      ...common,
      charts: await rootCharts(tx, delivery, references),
      siteArtifacts: await rootSiteArtifacts(
        tx,
        changes,
        delivery.repositoryId,
      ),
      prerequisites: prerequisites(
        changes,
        PLATFORM_POLICY.rootPrerequisites,
        source.id,
      ),
    });
  }
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
