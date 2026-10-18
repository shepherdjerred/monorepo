import { Context } from "@temporalio/activity";
import { z } from "zod";
import {
  DeploymentDetailSchema,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";
import {
  createTrmnlArchiveReader,
  readTrmnlArchive,
  inspectTrmnlArchive,
} from "@shepherdjerred/ops-clients/trmnl-archive.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";
import { configureTrmnlPlugins } from "#lib/delivery/trmnl.ts";
import { trmnlRepairClaim, verifyTrmnlRepairBackend } from "./trmnl-repair.ts";

export async function applyDeliveryTrmnlPlugins(
  id: string,
): Promise<EvidenceInput[]> {
  return await withBackupActivityHeartbeat(
    Context.current(),
    async ({ signal }) => await applyTrmnlWithClients(id, signal),
    { stage: "trmnl-plugins" },
  );
}
/** Every API write has a durable stage and repeats the exact same fixed resource overwrite only after readback. */
export async function applyTrmnlWithClients(
  id: string,
  signal: AbortSignal,
  effects?: {
    client: ReturnType<typeof createTrmnlPluginClient>;
    readArchive: ReturnType<typeof createTrmnlArchiveReader>;
    repairClaim?: typeof trmnlRepairClaim;
    verifyBackend?: typeof verifyTrmnlRepairBackend;
  },
): Promise<EvidenceInput[]> {
  const base = `deployments/${encodeURIComponent(id)}`;
  const detail = await deliveryRequest(base, DeploymentDetailSchema);
  const pipeline = detail.pipeline.definition;
  if (
    pipeline.kind !== "argocd" ||
    pipeline.trmnlPlugins === undefined ||
    detail.deployment.status !== "running" ||
    detail.deployment.cancelRequested ||
    detail.environment.activeDeploymentId !== id
  )
    throw new Error(
      "TRMNL dependency configuration lacks its active frozen application claim",
    );
  const backend = detail.stages.find((stage) => stage.key === "trmnl-backend");
  const repair = detail.deployment.kind === "repair-trmnl";
  if (
    !repair &&
    (backend?.status !== "succeeded" ||
      backend.operationId !== deliveryOperationId(id))
  )
    throw new Error(
      "TRMNL backend must be independently healthy before plugin configuration",
    );
  const verifyBackend = effects?.verifyBackend ?? verifyTrmnlRepairBackend;
  const backendEvidence = repair ? await verifyBackend(detail) : [];
  const archive =
    detail.versionSet.components[pipeline.trmnlPlugins.archiveComponent];
  if (archive?.kind !== "archive")
    throw new Error("Missing frozen TRMNL plugin archive");
  const clients = effects ?? {
    client: createTrmnlPluginClient({
      token: z.string().min(1).parse(Bun.env["TRMNL_API_KEY"]),
      signal,
    }),
    readArchive: createTrmnlArchiveReader(
      {
        accessKeyId: z
          .string()
          .min(1)
          .parse(Bun.env["DELIVERY_TRMNL_S3_ACCESS_KEY_ID"]),
        secretAccessKey: z
          .string()
          .min(1)
          .parse(Bun.env["DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY"]),
      },
      signal,
    ),
  };
  const bundle = await readTrmnlArchive(archive, clients.readArchive);
  const operationId = deliveryOperationId(`${id}:trmnl-plugins`);
  const stage = async (
    key: string,
    status: "running" | "succeeded",
    evidence: EvidenceInput[] = [],
  ) =>
    await deliveryRequest(`${base}/stages`, z.unknown(), {
      key,
      status,
      operationId:
        key === "trmnl-plugins"
          ? operationId
          : deliveryOperationId(`${id}:${key}`),
      message: `Exact fixed TRMNL plugin archive ${archive.id}: ${status}`,
      evidence,
    });
  await stage("trmnl-plugins", "running");
  await configureTrmnlPlugins(bundle, {
    client: clients.client,
    signal,
    async fence() {
      const current = await deliveryRequest(
        `${base}/claim`,
        DeploymentDetailSchema,
        (await (effects?.repairClaim ?? trmnlRepairClaim)(
          await deliveryRequest(base, DeploymentDetailSchema),
        )) ?? {},
      );
      if (
        current.deployment.status !== "running" ||
        current.deployment.cancelRequested ||
        current.environment.activeDeploymentId !== id ||
        current.deployment.versionSetRevisionId !==
          detail.deployment.versionSetRevisionId
      )
        throw new Error("TRMNL dependency write lost its exact active claim");
    },
    async stage(pluginId, status) {
      const key = `trmnl-plugin-${String(pluginId)}`;
      await stage(
        key,
        status,
        status === "running"
          ? []
          : [
              {
                kind: "reconciliation",
                operationId: deliveryOperationId(`${id}:${key}`),
                summary: `Fixed TRMNL plugin ${String(pluginId)} readback matches original archive ${archive.digest}`,
              },
            ],
      );
    },
  });
  await inspectTrmnlArchive(archive, clients);
  if (repair) backendEvidence.push(...(await verifyBackend(detail)));
  const evidence: EvidenceInput[] = [
    ...backendEvidence,
    {
      kind: "reconciliation",
      operationId,
      summary:
        "All fixed TRMNL plugin resources independently match the frozen archive",
    },
    {
      kind: "acceptance",
      operationId,
      summary: JSON.stringify({
        adapter: "trmnl-plugins",
        archiveArtifactId: archive.id,
        archiveDigest: archive.digest,
        versionSetRevisionId: detail.deployment.versionSetRevisionId,
        pluginCount: 3,
      }),
    },
  ];
  await stage("trmnl-plugins", "succeeded", evidence);
  return evidence;
}
