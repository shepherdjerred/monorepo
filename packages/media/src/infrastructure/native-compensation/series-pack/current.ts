import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import {
  nativeHousehold,
  nativeJson,
  NativeHouseholdSchema,
} from "#infrastructure/native-recovery/snapshots.ts";
import { archiveMedia } from "#infrastructure/native-archive/snapshots.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { SeriesPackNativeCompensationScopeV3Schema } from "#shared/native-recovery/series-pack/scope.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { assertNativeOwner } from "#infrastructure/native-recovery/owner.ts";
import { runtimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoSubtitleReplacement } from "#infrastructure/subtitle-replacement/locks.ts";
import { assertNativeExclusion } from "#infrastructure/native-recovery/guards.ts";
import { assertLegacyClaimsResolved } from "#infrastructure/recovery/legacy-claims/protection.ts";
import type { SeriesPackNativeRecordV1 } from "./records.ts";
import {
  captureSeriesPackInterruptedV1,
  seriesPackInterruptedLifecycleV1,
} from "./interrupted.ts";

/** Immutable grants remain actual same-TX parents; mutable knowledge is checked
 * at each callback under whole canonical/request/runtime/asset/caption locks.
 */
export async function assertSeriesPackNativeCurrentV1(
  tx: Prisma.TransactionClient,
  record: SeriesPackNativeRecordV1,
) {
  if (record.transaction !== tx || record.completion !== null)
    throw new Error(
      "A foreign or completed native phase cannot authorize effects",
    );
  const { row, descriptor } = record;
  const scope = descriptor.scope;
  await assertNoSubtitleReplacement(tx, row.assetIds);
  await assertNativeExclusion(tx);
  await assertLegacyClaimsResolved(tx, row.mediaIds, record.budget);
  const runtime = await runtimeAuthority(tx, record.budget);
  if (!runtime.active || runtime.epoch !== row.recoveryEpoch)
    throw new NativeCompensationProtection("compensation_runtime_protected");
  await tx.$queryRaw`SELECT media_series_pack_native_before_v1(${z.json().parse(scope.publication.intent)}::jsonb,${row.recoveryEpoch})::text`;
  const interrupted = await captureSeriesPackInterruptedV1(tx, record.graph);
  if (identityHash(interrupted) !== identityHash(scope.interruptedWork))
    throw new NativeCompensationProtection(
      "compensation_interrupted_work_changed",
    );
  const media = await archiveMedia(tx, row.mediaIds);
  if (identityHash(nativeJson(media)) !== identityHash(scope.media))
    throw new NativeCompensationProtection(
      "compensation_current_intent_or_catalog_changed",
    );
  const ancestors = media.flatMap((item) =>
    [item.parent?.id, item.parent?.parent?.id].filter((id) => id !== undefined),
  );
  const household = await nativeHousehold(tx, row.mediaIds, ancestors);
  const reviewed = NativeHouseholdSchema.parse(scope.household);
  for (const key of ["requests", "coverage", "personalHolds"] as const)
    if (identityHash(household[key]) !== identityHash(reviewed[key]))
      throw new NativeCompensationProtection("compensation_household_changed");
  const holds = record.selection.compensationAuthorization.recoveryHoldBindings;
  if (
    holds.length !== row.mediaIds.length ||
    household.recoveryHolds.length !== row.mediaIds.length ||
    household.recoveryHolds.some(
      (hold) =>
        hold["releasedAt"] !== null ||
        !holds.some(
          (bound) =>
            bound.mediaId === hold.mediaId &&
            bound.version === hold.version &&
            bound.recoveryEpoch === hold.recoveryEpoch,
        ),
    )
  )
    throw new NativeCompensationProtection(
      "compensation_recovery_hold_changed",
    );
  const lifecycle = await seriesPackInterruptedLifecycleV1(
    tx,
    record.graph,
    interrupted,
  );
  if (identityHash(lifecycle) !== identityHash(scope.lifecycle))
    throw new NativeCompensationProtection(
      "compensation_reviewed_records_changed",
    );
  return SeriesPackNativeCompensationScopeV3Schema.parse({
    ...scope,
    media,
    household,
  });
}

/** The owner row was not included in another model: pay its actual grant read. */
export async function assertSeriesPackNativeOwnerV1(
  record: SeriesPackNativeRecordV1,
) {
  await assertNativeOwner(record.transaction, record.row.receipt.actorId);
  record.budget.consume(1);
}
