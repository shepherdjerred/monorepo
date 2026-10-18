import { z } from "zod";
import {
  CompletePlatformRecoverySchema,
  PlatformRecoveryContextSchema,
  RecordPlatformRecoveryPlanSchema,
  type CompletePlatformRecovery,
  type PlatformRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { deliveryRequest } from "#lib/delivery/client.ts";
import type { runDeliveryJob } from "#lib/delivery/job.ts";
import type { DeliveryJobReceipt } from "#shared/delivery-job.ts";
import { recoveryExecutionJob, type RecoveryAction } from "./request.ts";

const Inspection = z.strictObject({
  state: z.enum(["desired", "prior", "readonly"]),
  observedAt: z.iso.datetime(),
  proofSummary: z.string().min(20).max(4000),
});
export type PlatformRecoveryExecutor = {
  runJob: typeof runDeliveryJob;
  closedWorkflow: (
    id: string,
  ) => Promise<CompletePlatformRecovery["sourceWorkflow"]>;
  nativeJobs: (
    context: PlatformRecoveryContext,
  ) => Promise<CompletePlatformRecovery["nativeJobs"]>;
};

/** Activity and outage CLI use this same receipt, saved-plan and final independent CAS boundary. */
export async function executePlatformRecoveryAction(
  id: string,
  action: RecoveryAction,
  effects: PlatformRecoveryExecutor,
) {
  const base = `platform-recovery/${encodeURIComponent(id)}`;
  const context = await deliveryRequest(base, PlatformRecoveryContextSchema);
  if (context.intent.status !== "pending")
    throw new Error("Recovery intent is not pending");
  const priorIndex =
    action === "inspect"
      ? -1
      : context.intent.nativeReceipts.findIndex(
          (entry) => entry.action === action,
        );
  const attempt =
    priorIndex < 0 ? context.intent.nativeReceipts.length + 1 : priorIndex + 1;
  const request = recoveryExecutionJob(context, {
    intent: context.intent,
    action,
    attempt,
  });
  const existing = context.intent.nativeReceipts[priorIndex]?.receipt;
  let native: DeliveryJobReceipt | undefined;
  const result = await effects.runJob(
    request,
    async (receipt) => {
      native = receipt;
      await deliveryRequest(`${base}/native`, z.unknown(), { action, receipt });
    },
    existing === undefined
      ? undefined
      : { createIfAbsent: false, expectedReceipt: existing },
  );
  if (native === undefined)
    throw new Error("Recovery result has no durable native execution receipt");
  if (action === "plan") {
    const record = RecordPlatformRecoveryPlanSchema.parse(result);
    if (
      record.receipt.recoveryIntentId !== id ||
      canonicalJson(record.receipt.nativeJob) !== canonicalJson(native)
    )
      throw new Error(
        "Recovery plan differs from its actual native producer identity",
      );
    await deliveryRequest(`${base}/plan`, z.unknown(), record);
    return {
      status: "planned" as const,
      planDigest: record.receipt.planDigest,
    };
  }
  if (action === "apply")
    return { status: "applied-needs-inspection" as const };
  const observed = Inspection.parse(result);
  if (
    Date.now() - Date.parse(observed.observedAt) > 60_000 ||
    Date.parse(observed.observedAt) > Date.now() + 5000
  )
    throw new Error(
      "Recovery target inspection expired; repeat an independent inspection",
    );
  const current = await deliveryRequest(base, PlatformRecoveryContextSchema);
  const fingerprint = current.expectedSettlements[observed.state];
  if (fingerprint === undefined)
    throw new Error(
      "No immutable settlement fingerprint exists for the observed target",
    );
  const sourceWorkflow = await effects.closedWorkflow(
    current.deployment.deployment.id,
  );
  const nativeJobs = await effects.nativeJobs(current);
  const proof = CompletePlatformRecoverySchema.parse({
    expectedEnvironmentGeneration: current.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: current.intent.snapshotFingerprint,
    observedAt: observed.observedAt,
    sourceWorkflow,
    nativeJobs,
    settlement: { state: observed.state, fingerprint },
    proofSummary: observed.proofSummary,
  });
  await deliveryRequest(`${base}/complete`, z.unknown(), proof);
  return {
    status: "settled" as const,
    originalDeploymentResult: "unchanged" as const,
  };
}
