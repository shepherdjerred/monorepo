import { z } from "zod";
import {
  DeploymentDetailSchema,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import {
  prepareStaticSite,
  applyStaticSite,
  verifyStaticSite,
} from "./static-site.ts";
import { executorIdentity } from "./model/stages.ts";

/** Frontend effects follow backend acceptance under the same frozen release lock. */
export async function applyDeliveryScoutSite(
  id: string,
): Promise<EvidenceInput[]> {
  const path = `deployments/${encodeURIComponent(id)}`;
  const detail = await deliveryRequest(path, DeploymentDetailSchema);
  const pipeline = detail.pipeline.definition;
  if (
    pipeline.kind !== "argocd" ||
    pipeline.scoutSite === undefined ||
    detail.deployment.workerSnapshot?.workerOperation !== "rollout" ||
    detail.deployment.cancelRequested ||
    detail.environment.activeDeploymentId !== id
  )
    throw new Error(
      "Scout frontend activation lacks an active full-release claim",
    );
  if (
    !detail.stages.some(
      (stage) =>
        stage.key === "scout-backend" &&
        stage.status === "succeeded" &&
        stage.operationId === deliveryOperationId(id),
    )
  )
    throw new Error(
      "Scout backend must be independently accepted before frontend activation",
    );
  const operationId = deliveryOperationId(`${id}:scout-site`);
  const archive =
    detail.versionSet.components[pipeline.scoutSite.archiveComponent];
  if (archive?.kind !== "archive")
    throw new Error("Scout release lacks its frozen frontend archive");
  await prepareStaticSite(detail);
  const stage = async (
    status: "running" | "succeeded",
    evidence: EvidenceInput[],
  ) =>
    await deliveryRequest(`${path}/stages`, z.unknown(), {
      key: "scout-site",
      status,
      operationId,
      message: `Scout frontend ${status}`,
      evidence,
      executor: executorIdentity(),
    });
  await stage("running", []);
  await applyStaticSite(detail);
  const evidence = await verifyStaticSite(detail);
  evidence.push({
    kind: "acceptance",
    operationId,
    summary: JSON.stringify({
      adapter: "scout-site",
      archiveArtifactId: archive.id,
      archiveDigest: archive.digest,
      versionSetRevisionId: detail.deployment.versionSetRevisionId,
      bucket: pipeline.scoutSite.bucket,
    }),
  });
  await stage("succeeded", evidence);
  return evidence;
}
