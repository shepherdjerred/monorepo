import { DeliveryError } from "#domain/error.ts";
import type { Delivery } from "#infrastructure/delivery.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import type { ContentRecoveryOwnership } from "#shared/contract.ts";
import { requireContentQuiescence } from "./ownership.ts";
import { recordedContentWorkerJobs } from "./context.ts";

export async function inspectContentProof(
  delivery: Delivery,
  id: string,
  proof: ContentRecoveryOwnership,
  options: { activeRepairJobUIDs?: string[]; restoring?: boolean } = {},
) {
  const { activeRepairJobUIDs = [], restoring = false } = options;
  const context = await delivery.contentRecovery(id, {
    id: "internal-content-proof",
    kind: "machine",
    scopes: ["read"],
  });
  requireContentQuiescence(
    restoring
      ? {
          ...context.intent,
          expectedEnvironmentGeneration:
            context.intent.expectedEnvironmentGeneration + 1,
        }
      : context.intent,
    proof,
  );
  const current = context.intent.nativeReceipts.filter(
    (entry) =>
      entry.action === "repair" &&
      activeRepairJobUIDs.includes(entry.receipt.uid),
  );
  if (
    new Set(activeRepairJobUIDs).size !== activeRepairJobUIDs.length ||
    current.length !== activeRepairJobUIDs.length ||
    new Set(current.map((entry) => entry.receipt.namespace)).size !==
      current.length
  )
    throw new DeliveryError(
      "CONFLICT",
      "Only the exact current checkpointed Forum repair child may remain live",
    );
  const all = context.recoveryHistory.flatMap(
    (intent) => intent.nativeReceipts,
  );
  for (const receipt of recordedContentWorkerJobs(context.deployment))
    all.push({ action: "original", receipt });
  if (
    context.intent.targetKind === "forum" &&
    !all.some((entry) => entry.action === "original")
  )
    throw new DeliveryError(
      "CONFLICT",
      "Forum recovery must retain the independently observed original release Job UID and exact specification",
    );
  for (const entry of all) {
    if (
      activeRepairJobUIDs.length > 0 &&
      current.some((candidate) => fingerprint(candidate) === fingerprint(entry))
    )
      continue;
    const job = entry.receipt;
    if (
      !proof.nativeJobs.some(
        (observed) =>
          observed.namespace === job.namespace &&
          observed.name === job.name &&
          observed.uid === job.uid &&
          observed.specFingerprint === job.specFingerprint &&
          observed.requestId === job.requestId &&
          (observed.status !== "Deleted" || observed.podsAbsent),
      )
    )
      throw new DeliveryError(
        "CONFLICT",
        "Every original and historical recovery Job must have exact independently terminal Pods and native identity; missing receipt or absence alone is insufficient",
      );
  }
  return context;
}
