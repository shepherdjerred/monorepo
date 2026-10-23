import { createHash } from "node:crypto";
import type { ApplicationReader } from "#infrastructure/kubernetes/application-reader.ts";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { DeliveryError } from "#domain/error.ts";
import type { DeploymentDetail } from "#shared/contract.ts";
import type { MinecraftRecoveryIntent } from "#shared/minecraft-recovery-contract.ts";
import { MinecraftControllerReceiptSchema } from "#shared/minecraft-recovery-contract.ts";
import {
  MinecraftRecoveryReportEnvelopeSchema,
  parseMinecraftRecoveryReport,
} from "#shared/minecraft-recovery-report.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";

const Argo = z.object({
  metadata: z.object({
    uid: z.string().min(1),
    resourceVersion: z.string().min(1),
  }),
  spec: z.object({ source: z.record(z.string(), z.json()) }),
  operation: z.unknown().optional(),
  status: z.object({
    operationState: z
      .object({ phase: z.enum(["Succeeded", "Failed", "Error"]) })
      .optional(),
    resources: z
      .array(
        z.object({
          kind: z.string(),
          health: z.object({ status: z.string() }).optional(),
        }),
      )
      .default([]),
  }),
});
export type MinecraftRecoveryInspection = ReturnType<
  typeof parseMinecraftRecoveryReport
>;
export type InspectMinecraftRecovery = (
  intent: MinecraftRecoveryIntent,
  detail: DeploymentDetail,
) => Promise<MinecraftRecoveryInspection>;

// The Python journal uses UTF-8 JSON with sort_keys=True, not PG's locale-sorted fingerprint.
function sourceJson(value: z.infer<ReturnType<typeof z.json>>): string {
  if (Array.isArray(value))
    return `[${value.map((entry) => sourceJson(entry)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      )
      .map(([key, entry]) => `${JSON.stringify(key)}:${sourceJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function requireSameArgo(
  argo: z.infer<typeof Argo>,
  report: MinecraftRecoveryInspection,
) {
  if (
    (argo.operation !== undefined && argo.operation !== null) ||
    argo.metadata.uid !== report.application.uid ||
    argo.metadata.resourceVersion !== report.application.resourceVersion ||
    createHash("sha256").update(sourceJson(argo.spec.source)).digest("hex") !==
      report.application.sourceSha256 ||
    (argo.status.operationState?.phase ?? "none") !==
      report.application.operationPhase ||
    argo.status.resources.some(
      (resource) =>
        resource.kind === "Job" && resource.health?.status !== "Healthy",
    )
  )
    throw new DeliveryError(
      "CONFLICT",
      "Minecraft Argo source or operation changed after the independent original-volume inspection",
    );
}

/** Independently reads the private controller journal and current Argo source. API callers supply no observations. */
export function createMinecraftRecoveryInspector(options: {
  controllerOrigin: string;
  executorToken: string | undefined;
  readApplication: ApplicationReader;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
}): InspectMinecraftRecovery {
  return async (intent, detail) => {
    if (options.executorToken === undefined)
      throw new DeliveryError(
        "PAUSED",
        "Independent Minecraft recovery read credentials are unavailable",
      );
    const controller = MinecraftControllerReceiptSchema.parse(
      intent.controllerReceipt,
    );
    const operationId = deliveryOperationId(
      `${detail.deployment.id}:minecraft-preservation`,
    );
    const response = await (options.fetch ?? fetch)(
      new URL(`/requests/${operationId}/report`, options.controllerOrigin),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.executorToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          deploymentId: detail.deployment.id,
          recoveryId: intent.id,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok)
      throw new DeliveryError(
        "PAUSED",
        `Independent Minecraft report unavailable (${String(response.status)})`,
      );
    const result = MinecraftRecoveryReportEnvelopeSchema.parse(
      await response.json(),
    );
    const report = parseMinecraftRecoveryReport(JSON.parse(result.reportJson));
    const timestamp = Date.parse(report.observedAt);
    if (
      result.requestId !== operationId ||
      report.requestId !== operationId ||
      fingerprint(result.controller) !== fingerprint(controller) ||
      result.reportSha256 !==
        `sha256:${createHash("sha256").update(result.reportJson).digest("hex")}` ||
      timestamp < Date.now() - 30_000 ||
      timestamp > Date.now() + 5000
    )
      throw new DeliveryError(
        "CONFLICT",
        "Minecraft recovery report is stale or differs from the recorded native request",
      );
    const argo = Argo.parse(await options.readApplication("minecraft-tsmc"));
    requireSameArgo(argo, report);
    return report;
  };
}
