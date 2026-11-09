import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  runtimeAuthority,
  recordsAuthorized,
} from "#infrastructure/handoff/authority.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import type { PlexBindingFreshness } from "#shared/plex-binding/contract.ts";
import type { readSeriesPackNativeCoreRecordV1 } from "#infrastructure/native-compensation/series-pack/records.ts";

/** Current operational/CAS checks under the complete cohort locks. No queried
 * inventory snapshot is returned or recast as an immutable parent. SQL compares
 * the complete current inventory with the actual paid completion before images. */
export async function assertSeriesPackNativePublicationCurrentV1(
  tx: Prisma.TransactionClient,
  record: Awaited<ReturnType<typeof readSeriesPackNativeCoreRecordV1>>,
  timing: {
    observed: { wall: number; monotonic: number };
    originalFreshness: PlexBindingFreshness;
  },
) {
  timing.originalFreshness.assertActive();
  if (
    record.transaction !== tx ||
    record.completion === null ||
    record.row.fenceRelease !== null
  )
    throw new NativeCompensationProtection("compensation_publication_changed");
  const { row, descriptor, completion } = record;
  const runtime = await runtimeAuthority(tx, record.budget);
  const lease = await tx.legacyWriterLease.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
    throw new NativeCompensationProtection(
      "compensation_publication_runtime_changed",
    );
  await assertNativeExclusion(tx);
  await assertNoSubtitleReplacement(tx, row.assetIds);
  const intents = await tx.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: row.mediaIds } },
    orderBy: { mediaId: "asc" },
  });
  const claims = await tx.mediaRequest.findMany({
    where: { ...effectiveRequestWhere, mediaId: { in: row.mediaIds } },
    select: { mediaId: true },
  });
  if (
    intents.length !== row.mediaIds.length ||
    intents.some(
      (item) =>
        item.automationEpoch !== row.recoveryEpoch ||
        !item.desiredPresence ||
        !item.monitoring ||
        item.intentionallyRemovedAt !== null,
    ) ||
    row.mediaIds.some((id) => !claims.some((claim) => claim.mediaId === id))
  )
    throw new NativeCompensationProtection(
      "compensation_all_leaves_need_current_positive_intent",
    );
  if (
    await tx.recoveryHold.count({
      where: {
        edition: "default",
        mediaId: { in: row.mediaIds },
        releasedAt: null,
      },
    })
  )
    throw new NativeCompensationProtection(
      "compensation_household_reconciliation_required",
    );
  await tx.$queryRaw`SELECT media_series_pack_native_current_bindings_v1(${z.json().parse(completion)}::jsonb)::text`;
  const assets = completion.predecessorBindings.map(({ after }) => after.id);
  if (
    !(await recordsAuthorized(tx, {
      epoch: row.recoveryEpoch,
      mediaIds: row.mediaIds,
      assetIds: assets,
    }))
  )
    throw new NativeCompensationProtection(
      "compensation_publication_record_authority_changed",
    );
  const roots = await tx.mediaStorageAuthority.findMany({
    where: {
      rootPath: {
        in: descriptor.scope.storageRoots.map((root) => root.rootPath),
      },
    },
  });
  const now = Date.now();
  if (
    roots.length !== descriptor.scope.storageRoots.length ||
    roots.some(
      (root) =>
        root.revokedAt !== null ||
        root.recoveryEpoch !== row.recoveryEpoch ||
        root.observedAt.getTime() > now ||
        root.expiresAt.getTime() <= now ||
        root.expiresAt.getTime() - root.observedAt.getTime() > 120_000,
    ) ||
    lease.revokedAt !== null ||
    lease.recoveryEpoch !== row.recoveryEpoch ||
    lease.observedAt.getTime() > now ||
    lease.expiresAt.getTime() <= now
  )
    throw new NativeCompensationProtection(
      "compensation_publication_storage_changed",
    );
  const freshness = plexBindingFreshness({
    observed: timing.observed,
    expiresAtMs: Math.min(
      timing.originalFreshness.expiresAtMs,
      lease.expiresAt.getTime(),
      ...roots.map((root) => root.expiresAt.getTime()),
    ),
    guards: [timing.originalFreshness],
  });
  freshness.assertActive();
  return {
    generations: Object.fromEntries(
      intents.map((intent) => [intent.mediaId, intent.generation]),
    ),
    freshness,
  };
}

export function assertSeriesPackNativeGenerationsV1(
  expected: Record<string, number>,
  current: Record<string, number>,
) {
  if (identityHash(expected) !== identityHash(current))
    throw new NativeCompensationProtection(
      "compensation_publication_generation_changed",
    );
}
