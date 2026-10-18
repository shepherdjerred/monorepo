import { z } from "zod";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import {
  PipelineRevisionSchema,
  PlatformReleaseSnapshotSchema,
} from "#shared/contract.ts";
import {
  artifact,
  evidence,
  type Transaction,
} from "#infrastructure/delivery-data.ts";
import { required, wire } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import { nativeReceipt } from "./policy.ts";

const RootLink = z
  .object({
    adapter: z.literal("site-root"),
    rootDeploymentId: z.string().min(1),
    archiveArtifactId: z.string().min(1),
    environmentId: z.string().min(1),
    mode: z.enum(["current", "rollback-history"]),
  })
  .strict();
type Release = {
  id: string;
  kind: string;
  serviceId: string;
  environmentId: string;
  versionSetRevisionId: string;
  pipelineRevisionId: string;
};

async function acceptedRoot(tx: Transaction) {
  const env = required(
    await tx.environment.findUnique({ where: { id: "gitops/root" } }),
    "Accepted root infrastructure environment",
  );
  if (env.activeDeploymentId !== null)
    throw new DeliveryError(
      "BUSY",
      "Waiting for root infrastructure reconciliation or recovery before site activation",
    );
  if (env.acceptedPlatformDeploymentId === null)
    throw new DeliveryError(
      "BUSY",
      "Waiting for genuine root infrastructure acceptance before site activation",
    );
  const row = required(
    await tx.deployment.findUnique({
      where: { id: env.acceptedPlatformDeploymentId },
    }),
    "Accepted root infrastructure deployment",
  );
  const snapshot = PlatformReleaseSnapshotSchema.parse(row.platformSnapshot);
  if (row.status !== "succeeded" || snapshot.kind !== "root-release")
    throw new DeliveryError(
      "CONFLICT",
      "Accepted infrastructure pointer does not identify a successful exact root inventory",
    );
  return { row, snapshot };
}

async function rollbackRoot(
  tx: Transaction,
  row: Release,
  archiveArtifactId: string,
) {
  const histories = await tx.deployment.findMany({
    where: {
      environmentId: row.environmentId,
      versionSetRevisionId: row.versionSetRevisionId,
      status: "succeeded",
    },
    include: { evidence: { where: { kind: "preflight" } } },
    orderBy: { finishedAt: "desc" },
  });
  for (const prior of histories)
    for (const item of prior.evidence) {
      if (!item.id.startsWith(`${prior.id}/root-prerequisite/`)) continue;
      const link = RootLink.safeParse(nativeReceipt(item.summary));
      if (
        !link.success ||
        link.data.archiveArtifactId !== archiveArtifactId ||
        link.data.environmentId !== row.environmentId
      )
        continue;
      const root = await tx.deployment.findUnique({
        where: { id: link.data.rootDeploymentId },
      });
      if (root?.status === "succeeded" && root.kind === "root-release")
        return link.data.rootDeploymentId;
    }
  throw new DeliveryError(
    "BUSY",
    "Rollback requires this exact archive's prior genuine site and root acceptance history",
  );
}

async function guardSite(
  tx: Transaction,
  input: { row: Release; catalog: ServiceIndex; repositoryId: number },
) {
  const { row } = input;
  const pipeline = PipelineRevisionSchema.parse(
    wire(
      required(
        await tx.pipeline.findUnique({ where: { id: row.pipelineRevisionId } }),
        "Site pipeline",
      ),
    ),
  );
  if (pipeline.definition.kind !== "static-site") return;
  const selected = required(
    await tx.versionSetEntry.findUnique({
      where: {
        revisionId_component: {
          revisionId: row.versionSetRevisionId,
          component: pipeline.definition.archiveComponent,
        },
      },
    }),
    "Frozen site archive",
  );
  const archive = await artifact(tx, selected.artifactId);
  let rootDeploymentId: string;
  if (row.kind === "rollback")
    rootDeploymentId = await rollbackRoot(tx, row, archive.id);
  else {
    const root = await acceptedRoot(tx);
    const binding = root.snapshot.siteArtifacts[row.environmentId];
    if (binding === undefined)
      throw new DeliveryError(
        "BUSY",
        "Current root inventory has no reviewed infrastructure binding for this site",
      );
    const claimed = await tx.build.count({
      where: {
        serviceId: "gitops",
        sourceKind: "ci",
        repositoryId: input.repositoryId,
        AND: [
          { platformChanges: { path: ["root"], equals: true } },
          {
            platformChanges: {
              path: ["sites"],
              array_contains: [
                { environmentId: row.environmentId, artifactId: archive.id },
              ],
            },
          },
        ],
      },
    });
    if (claimed > 0 && binding !== archive.id)
      throw new DeliveryError(
        "BUSY",
        "Waiting for current root acceptance declaring this exact original site archive; newer roots may retain the same artifact",
      );
    rootDeploymentId = root.row.id;
  }
  await evidence(
    tx,
    row.id,
    [
      {
        kind: "preflight",
        operationId: rootDeploymentId,
        summary: JSON.stringify({
          adapter: "site-root",
          rootDeploymentId,
          archiveArtifactId: archive.id,
          environmentId: row.environmentId,
          mode: row.kind === "rollback" ? "rollback-history" : "current",
        }),
      },
    ],
    `root-prerequisite/${rootDeploymentId}`,
  );
}

/** Root and independent-site effects use existing ownership markers under delivery:claim. */
export async function requireStaticRootBoundary(
  tx: Transaction,
  input: { row: Release; catalog: ServiceIndex; repositoryId: number },
) {
  if (input.catalog.catalog.platformDeliveryDelegated !== true) return;
  if (input.row.kind === "root-release") {
    const sites = await tx.deployment.count({
      where: {
        serviceId: "static-sites",
        OR: [{ status: "running" }, { recoveryRequired: true }],
      },
    });
    if (sites !== 0)
      throw new DeliveryError(
        "BUSY",
        "Waiting for existing independent site effects or recovery before changing root infrastructure",
      );
  }
  if (input.row.serviceId !== "static-sites") return;
  const rootEnvironment = await tx.environment.findUnique({
    where: { id: "gitops/root" },
  });
  if (
    rootEnvironment?.activeDeploymentId !== null &&
    rootEnvironment?.activeDeploymentId !== undefined
  )
    throw new DeliveryError(
      "BUSY",
      "Root infrastructure is reconciling or quarantined; site activation waits for its settled native state",
    );
  const held = await tx.platformLock.findUnique({
    where: { id: "shared-resources" },
    include: { deployment: true },
  });
  if (held !== null && held.deployment.kind === "tofu-apply") {
    const snapshot = PlatformReleaseSnapshotSchema.parse(
      held.deployment.platformSnapshot,
    );
    if (snapshot.kind === "tofu-apply" && snapshot.stack === "cloudflare")
      throw new DeliveryError(
        "BUSY",
        "Cloudflare holds exact site prerequisites during infrastructure application",
      );
  }
  await guardSite(tx, input);
}
