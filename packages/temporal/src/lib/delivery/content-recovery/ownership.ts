import { createHash } from "node:crypto";
import type { Connection } from "@temporalio/client";
import type {
  ContentRecoveryContext,
  ContentRecoveryOwnership,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { closedPlatformWorkflow } from "#lib/delivery/platform/recovery/native-proof.ts";
import {
  assertDeliveryDispatchPaused,
  type BarrierEffects,
} from "#lib/delivery/platform/control-plane-barrier.ts";
import {
  proveContentNativeJobs,
  type ContentNativeReader,
} from "./native-proof.ts";

export const contentFingerprint = (input: unknown) =>
  createHash("sha256").update(canonicalJson(input)).digest("hex");

export async function contentOwnership(
  context: ContentRecoveryContext,
  connection: Connection,
  read: ContentNativeReader,
  options: { barrier: BarrierEffects; activeUIDs?: string[] },
): Promise<ContentRecoveryOwnership> {
  const journal = context.intent.dispatchBarrier;
  if (journal === null)
    throw new Error("Content recovery has no durable producer barrier");
  await assertDeliveryDispatchPaused(options.barrier, journal);
  const sourceWorkflow = await closedPlatformWorkflow(
    connection,
    context.deployment.deployment.id,
  );
  const nativeJobs = await proveContentNativeJobs(
    context,
    read,
    options.activeUIDs,
  );
  await assertDeliveryDispatchPaused(options.barrier, journal);
  return {
    expectedEnvironmentGeneration:
      context.intent.expectedEnvironmentGeneration +
      (context.intent.status === "succeeded" ? 1 : 0),
    snapshotFingerprint: context.intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow,
    nativeJobs,
    quiescence: {
      deploymentUID: journal.deploymentUID,
      templateFingerprint: journal.templateFingerprint,
      replicas: 0,
      remainingPodUIDs: [],
      journalFingerprint: contentFingerprint(journal),
    },
  };
}
