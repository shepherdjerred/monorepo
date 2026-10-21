import { Connection } from "@temporalio/client";
import {
  DeploymentDetailSchema,
  type DeploymentDetail,
  type EvidenceInput,
} from "@shepherdjerred/delivery/contract";
import { deliveryRequest } from "#lib/delivery/client.ts";
import { deliverySelection } from "#lib/delivery/selection.ts";
import { closedPlatformWorkflow } from "#lib/delivery/platform/recovery/native-proof.ts";
import { argoApplicationRequest } from "#lib/delivery/argo-client.ts";
import { verifyArgoRelease } from "./argocd.ts";
import { observeDeliveryPods } from "./runtime.ts";

export async function trmnlRepairClaim(
  detail: {
    deployment: Pick<
      DeploymentDetail["deployment"],
      "kind" | "repairOfDeploymentId"
    >;
    environment: Pick<DeploymentDetail["environment"], "generation">;
  },
  inspectClosed?: (id: string) => ReturnType<typeof closedPlatformWorkflow>,
) {
  if (detail.deployment.kind !== "repair-trmnl") return;
  const prior = detail.deployment.repairOfDeploymentId;
  if (prior === null)
    throw new Error(
      "TRMNL repair lacks its immutable prior deployment identity",
    );
  if (inspectClosed !== undefined)
    return {
      sourceWorkflow: await inspectClosed(prior),
      observedAt: new Date().toISOString(),
      expectedEnvironmentGeneration: detail.environment.generation,
    };
  const connection = await Connection.connect({
    address: "temporal-temporal-server-service.temporal.svc.cluster.local:7233",
    connectTimeout: "10 seconds",
  });
  try {
    const sourceWorkflow = await closedPlatformWorkflow(connection, prior);
    return {
      sourceWorkflow,
      observedAt: new Date().toISOString(),
      expectedEnvironmentGeneration: detail.environment.generation,
    };
  } finally {
    await connection.close();
  }
}

/** Repairs never select Argo source; inspect the original backend owned operation before and after plugin effects. */
export async function verifyTrmnlRepairBackend(
  detail: DeploymentDetail,
  readArgo: (path: string) => Promise<unknown> = argoApplicationRequest,
): Promise<EvidenceInput[]> {
  let original = detail;
  for (let depth = 0; original.deployment.kind === "repair-trmnl"; depth++) {
    if (depth >= 20 || original.deployment.repairOfDeploymentId === null)
      throw new Error(
        "TRMNL repair lineage is absent or exceeds its fixed bound",
      );
    original = await deliveryRequest(
      `deployments/${encodeURIComponent(original.deployment.repairOfDeploymentId)}`,
      DeploymentDetailSchema,
    );
    if (
      original.deployment.versionSetRevisionId !==
        detail.deployment.versionSetRevisionId ||
      original.deployment.pipelineRevisionId !==
        detail.deployment.pipelineRevisionId ||
      original.deployment.configurationId !== detail.deployment.configurationId
    )
      throw new Error(
        "TRMNL repair lineage changed its frozen application release",
      );
  }
  const pipeline = original.pipeline.definition;
  if (pipeline.kind !== "argocd" || pipeline.trmnlPlugins === undefined)
    throw new Error(
      "TRMNL repair lacks its original ordinary application source",
    );
  const selected = deliverySelection(original);
  const native = verifyArgoRelease(
    await readArgo(encodeURIComponent(selected.selection.application)),
    selected.selection,
    selected.operationId,
  );
  await observeDeliveryPods(original, readArgo);
  if (pipeline.verification !== undefined) {
    const response = await fetch(pipeline.verification.url, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (response.status !== pipeline.verification.expectedStatus)
      throw new Error("TRMNL original backend is not independently healthy");
  }
  return [
    {
      kind: "reconciliation",
      operationId: native.operationId,
      summary: `TRMNL repair independently retained original backend operation ${selected.operationId} and exact ready image digests`,
    },
  ];
}
