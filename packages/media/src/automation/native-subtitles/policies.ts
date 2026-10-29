import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  currentSubtitlePolicies,
  lockSubtitlePolicies,
} from "#infrastructure/subtitle-policy.ts";
import {
  NativeSubtitlePolicySnapshotSchema,
  type NativeSubtitlePolicySnapshot,
} from "#shared/native-subtitles.ts";
import { snapshotHash } from "#migration/profile-import.ts";

/** Caller takes the policy advisory lock after media/runtime locks. Includes absent local policies. */
export async function snapshotNativeSubtitlePolicies(
  tx: Prisma.TransactionClient,
  mediaIds: readonly string[],
): Promise<NativeSubtitlePolicySnapshot[]> {
  const ids = [...new Set(mediaIds)].sort();
  if (ids.length > 100)
    throw new Error("Native subtitle policy scope exceeds bound");
  const effective = await currentSubtitlePolicies(tx, ids);
  const sourceIds = [...new Set(effective.map((policy) => policy.id))];
  const sources = await tx.mediaSubtitlePolicyVersion.findMany({
    where: { id: { in: sourceIds } },
  });
  return ids.map((mediaId) => {
    const binding = effective.find((policy) => policy.mediaId === mediaId);
    const source =
      binding === undefined
        ? undefined
        : sources.find((policy) => policy.id === binding.id);
    if (binding !== undefined && source === undefined)
      throw new Error("Native subtitle effective policy disappeared");
    // A local policy always takes precedence over inherited policies, so the
    // effective source proves local presence without loading historical rows.
    const local = source?.mediaId === mediaId ? source : undefined;
    return NativeSubtitlePolicySnapshotSchema.parse({
      mediaId,
      localPolicyId: local?.id ?? null,
      localVersion: local?.version ?? -1,
      effective:
        source === undefined
          ? null
          : {
              id: source.id,
              mediaId: source.mediaId,
              version: source.version,
              recoveryEpoch: source.recoveryEpoch,
              source: source.source,
              rules: source.rules,
            },
    });
  });
}

/** Physical ownership grants no demand. This only appends explicitly reviewed local policies;
 * it never modifies ancestor policy rows, intents, restored claims, or subtitle work queues. */
export async function appendNativeSubtitlePolicies(
  tx: Prisma.TransactionClient,
  input: {
    policies: NativeSubtitlePolicySnapshot[];
    epoch: number;
    actorId: string;
    planId: string;
  },
) {
  const ids = input.policies.map((policy) => policy.mediaId);
  if (new Set(ids).size !== ids.length)
    throw new Error("Native subtitle policy scope contains duplicates");
  await lockSubtitlePolicies(tx);
  const current = await snapshotNativeSubtitlePolicies(tx, ids);
  const expected = [...input.policies].sort((a, b) =>
    a.mediaId.localeCompare(b.mediaId),
  );
  if (snapshotHash(current) !== snapshotHash(expected))
    throw new Error("Native subtitle policy changed after owner review");
  const result = [];
  for (const policy of current) {
    const previous = policy.effective;
    if (previous === null) continue;
    if (previous.recoveryEpoch > input.epoch)
      throw new Error(
        "Native subtitle policy comes from a later recovery epoch",
      );
    const source = z.record(z.string(), z.json()).parse({
      kind: "native_restore",
      planId: input.planId,
      priorPolicyId: previous.id,
      priorPolicyMediaId: previous.mediaId,
      priorPolicyVersion: previous.version,
      priorRecoveryEpoch: previous.recoveryEpoch,
      provenance: previous.source,
    });
    const created = await tx.mediaSubtitlePolicyVersion.create({
      data: {
        mediaId: policy.mediaId,
        actorId: input.actorId,
        version: policy.localVersion + 1,
        recoveryEpoch: input.epoch,
        rules: previous.rules,
        source,
      },
    });
    result.push({
      mediaId: policy.mediaId,
      priorPolicyId: previous.id,
      policyId: created.id,
      version: created.version,
      recoveryEpoch: created.recoveryEpoch,
      rulesHash: snapshotHash(previous.rules),
      sourceHash: snapshotHash(source),
    });
  }
  return result;
}
