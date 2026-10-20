import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail, EvidenceInput } from "#shared/contract.ts";
import { RecoverDeploymentSchema } from "#shared/contract.ts";

export const RecoveryRequestSchema = RecoverDeploymentSchema.clone();
const ArgoRecoverySchema = z.object({
  metadata: z.object({
    name: z.string(),
    resourceVersion: z.string().min(1),
    annotations: z.record(z.string(), z.string()),
  }),
  operation: z.unknown().optional(),
  status: z.object({
    operationState: z.object({
      phase: z.enum(["Running", "Terminating", "Succeeded", "Failed", "Error"]),
      finishedAt: z.iso.datetime({ offset: true }).optional(),
      operation: z.object({
        info: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    }),
    resources: z.array(
      z.object({
        kind: z.string(),
        health: z.object({ status: z.string() }).optional(),
      }),
    ),
  }),
});

function requireSettled(
  current: z.infer<typeof ArgoRecoverySchema>,
  detail: DeploymentDetail,
  input: z.infer<typeof RecoveryRequestSchema>,
  requestId: string,
) {
  const operation = current.status.operationState;
  const application =
    detail.pipeline.definition.kind === "argocd"
      ? detail.pipeline.definition.application
      : null;
  if (
    current.metadata.name !== application ||
    current.metadata.annotations["delivery.shepherdjerred.com/environment"] !==
      detail.environment.id ||
    (current.operation !== undefined && current.operation !== null) ||
    ["Running", "Terminating"].includes(operation.phase) ||
    operation.finishedAt === undefined
  )
    throw new DeliveryError(
      "CONFLICT",
      "Argo ownership differs or work is unsettled; keep target ownership",
    );
  const requests = operation.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/request-id",
  );
  const identities = operation.operation.info.filter(
    (entry) => entry.name === "ci.sjer.red/operation-id",
  );
  if (
    requests.length !== 1 ||
    requests[0]?.value !== requestId ||
    identities.length !== 1 ||
    identities[0]?.value !== input.operationId
  )
    throw new DeliveryError(
      "CONFLICT",
      "Readback does not match the deployment's recorded request and supplied external operation identity",
    );
  if (
    current.status.resources.some(
      (entry) => entry.kind === "Job" && entry.health?.status !== "Healthy",
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Application includes an unsettled Job; inspect it through its specialized recovery procedure",
    );
  return operation.finishedAt;
}

/** Independent of Temporal: inspect the recorded operation directly through Argo. */
export function createRecoveryInspector(options: {
  origin: string;
  token: string | undefined;
  inspectTrmnl?: (detail: DeploymentDetail) => Promise<EvidenceInput[]>;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}) {
  return async (
    detail: DeploymentDetail,
    input: z.infer<typeof RecoveryRequestSchema>,
  ): Promise<EvidenceInput[]> => {
    if (
      detail.pipeline.definition.kind !== "argocd" ||
      detail.pipeline.definition.workerRollout !== undefined ||
      detail.pipeline.definition.scoutSite !== undefined ||
      detail.pipeline.definition.forumRelease !== undefined ||
      (detail.pipeline.definition.minecraftUpgrade !== undefined &&
        detail.pipeline.definition.minecraftUpgrade.releaseMode !==
          "retained-volume-restart")
    )
      throw new DeliveryError(
        "INVALID",
        "This target requires its specialized recovery procedure; retain ownership until its external work is settled",
      );
    if (options.token === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Argo recovery read credential is not configured",
      );
    if (
      detail.pipeline.definition.trmnlPlugins !== undefined &&
      options.inspectTrmnl === undefined
    )
      throw new DeliveryError(
        "PAUSED",
        "TRMNL recovery requires independent exact plugin-bundle readback; native Argo settlement alone is insufficient",
      );
    const recorded = detail.stages.find((entry) => entry.key === "reconcile");
    if (recorded === undefined)
      throw new DeliveryError(
        "CONFLICT",
        "Deployment has no recorded reconciliation operation to inspect",
      );
    const response = await (options.fetch ?? fetch)(
      new URL(
        `/api/v1/applications/${encodeURIComponent(detail.pipeline.definition.application)}`,
        options.origin,
      ),
      {
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(30_000),
        redirect: "error",
      },
    );
    if (!response.ok)
      throw new DeliveryError(
        "PAUSED",
        `Argo recovery inspection unavailable (${String(response.status)})`,
      );
    const raw: unknown = await response.json();
    const current = ArgoRecoverySchema.parse(raw);
    const operation = current.status.operationState;
    const finishedAt = requireSettled(
      current,
      detail,
      input,
      recorded.operationId,
    );
    const pluginEvidence =
      detail.pipeline.definition.trmnlPlugins !== undefined &&
      options.inspectTrmnl !== undefined
        ? await options.inspectTrmnl(detail)
        : [];
    return [
      {
        kind: "reconciliation",
        operationId: input.operationId,
        summary: `Independent Argo readback: ${current.metadata.name}, resourceVersion ${current.metadata.resourceVersion}, request ${recorded.operationId}, operation ${input.operationId}, phase ${operation.phase}, finished ${finishedAt}. ${input.reason}`,
      },
      ...pluginEvidence,
    ];
  };
}
