import type { NativeFileContext } from "#automation/native-recovery/files.ts";
import type { SeriesPackNativeFileExecutionV1 } from "#shared/native-recovery/series-pack/activities.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { type SeriesPackNativeActivityV1 } from "#shared/native-recovery/series-pack/runtime.ts";
import { NativeCompensationActivityInputSchema } from "#shared/native-recovery/compensation-runtime.ts";
import { readSeriesPackNativeCompletedV1 } from "#infrastructure/native-compensation/series-pack/completed.ts";
import { loadSeriesPackNativePhaseV1 } from "#infrastructure/native-compensation/series-pack/phase.ts";
import { reserveSeriesPackNativeSqlV1 } from "#infrastructure/native-compensation/series-pack/sql-budget.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { PendingLegacyClaimsError } from "#infrastructure/recovery/legacy-claims/protection.ts";
import { publicationAuthorityDeadline } from "#automation/publication-proof/authority.ts";
import {
  bindPlexTransactionDeadline,
  plexBindingFreshness,
} from "#infrastructure/plex-binding/freshness.ts";
import {
  prepareMeasuredPublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "#automation/publication-proof/recording.ts";
import { executePublicationInverse } from "#automation/publication-proof/inverse.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { discoverSeriesPackNativeV1 } from "./discovery.ts";
import { measureSeriesPackNativeExecutionV1 } from "./measurement.ts";
import {
  seriesPackNativeFileContextV1,
  seriesPackNativeBindingExecutionV1,
} from "./execution.ts";
import { completeSeriesPackNativeCompensationV1 } from "./complete.ts";

async function execute(
  initial: NativeFileContext,
  input: SeriesPackNativeActivityV1,
  invocation: {
    execution: SeriesPackNativeFileExecutionV1;
    budget: PublicationAuthorityReadBudget;
  },
) {
  const { execution, budget } = invocation;
  const context = seriesPackNativeFileContextV1(initial, execution);
  const db = context.files.db;
  if (
    await db.$transaction((tx) =>
      readSeriesPackNativeCompletedV1(tx, input, budget),
    )
  )
    return;
  const discovery = await discoverSeriesPackNativeV1(
    db,
    input,
    seriesPackNativeBindingExecutionV1(execution),
    budget,
  );
  const measured = await measureSeriesPackNativeExecutionV1(
    context,
    discovery,
    discovery.freshness.assertActive,
  );
  await context.files.checkpoint("series-pack-native-compensation-measured");
  await db.$transaction(
    async (tx) => {
      const phase = await loadSeriesPackNativePhaseV1(tx, input, budget, {
        freshness: discovery.freshness,
      });
      if (phase.kind === "completed") return;
      const { receipt: _receipt, ...continuation } = phase.record.row;
      if (
        phase.proof === null ||
        identityHash(nativeJson(phase.operation)) !== discovery.operationHash ||
        identityHash(nativeJson(phase.record.row.receipt.plan)) !==
          discovery.planHash ||
        identityHash(nativeJson(continuation)) !== discovery.continuationHash ||
        identityHash(phase.proof.ref) !== identityHash(discovery.ref)
      )
        throw new Error(
          "Native pack measured facts changed before their actual complete held phase",
        );
      const rootDeadline = await publicationAuthorityDeadline(
        tx,
        context.files,
        { libraryKind: "tv", recoveryEpoch: input.recoveryEpoch },
      );
      const freshness = plexBindingFreshness({
        observed: execution.observed,
        expiresAtMs: Math.min(
          discovery.freshness.expiresAtMs,
          rootDeadline.expiresAtMs,
        ),
        guards: [execution, discovery.freshness, rootDeadline],
      });
      await bindPlexTransactionDeadline(tx, freshness);
      const assertCurrent = async () => {
        freshness.assertActive();
        await phase.assertCurrent();
        if (
          phase.proof === null ||
          phase.proof.network.mounts.mounts.some(
            (mount) => mount.podUid !== context.workerPodUid,
          ) ||
          identityHash(await context.files.plexAccess("show")) !==
            identityHash(phase.proof.network.access)
        )
          throw new NativeCompensationProtection(
            "compensation_executor_or_config_changed",
          );
        await context.files.verifyStorageAuthority(context.files.roots.tv);
        if (context.files.verifyPlexExclusion === undefined)
          throw new Error("Native pack exclusion verifier missing");
        await context.files.verifyPlexExclusion(context.files.roots.tv);
        freshness.assertActive();
      };
      await assertCurrent();
      reserveSeriesPackNativeSqlV1(
        budget,
        phase.record.descriptor.scope,
        "begin",
      );
      await tx.$queryRaw`SELECT media_series_pack_native_begin_v1(${input.continuationId})::text`;
      const prepared = await measured.seal({
        assertActive: freshness.assertActive,
        assertCurrent,
      });
      const stores = await prepareMeasuredPublicationStores(
        prepared.context.files,
        {
          transitionId: measured.intent.transitionId,
          continuationId: input.continuationId,
          plan: measured.plan,
          measurements: measured.measurements,
          authority: { assertActive: freshness.assertActive, assertCurrent },
        },
      );
      for (const store of stores) store.bindAuthority(freshness.assertActive);
      const recording = publicationRecording(
        prepared.context.files,
        measured.intent,
        stores,
        {
          inverse: { continuationId: input.continuationId },
          acknowledged: measured.allRecords.filter(
            (record) => record.continuationId !== input.continuationId,
          ),
        },
      );
      const operations = recording.operations(async () => {
        await assertCurrent();
      });
      await withPublicationPaths(
        prepared.context.files,
        measured.plan,
        operations,
        async () => {
          await recording.assertCurrent();
          await prepared.assertCurrent();
          await assertCurrent();
          for (const action of recording.actions) {
            const files = operations.find(
              (item) => item.kind === action.entry.libraryKind,
            )?.files;
            if (files === undefined)
              throw new Error("Native pack inverse root executor missing");
            await executePublicationInverse(files, action);
          }
          if (recording.state.next !== undefined)
            throw new FileOperationConflict(
              "Native pack inverse is incomplete",
            );
          await recording.assertCurrent();
          await assertCurrent();
          await completeSeriesPackNativeCompensationV1(tx, phase, {
            context: prepared.context.files,
            state: recording.state,
          });
          await context.files.checkpoint(
            "series-pack-native-compensation-before-commit",
          );
          await recording.assertCurrent();
          freshness.assertActive();
        },
      );
      for (const store of stores) store.assertActive();
      freshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

export async function compensateSeriesPackNativePublicationV1(
  initial: NativeFileContext,
  raw: SeriesPackNativeActivityV1,
  execution: SeriesPackNativeFileExecutionV1,
  budget: PublicationAuthorityReadBudget,
): Promise<{ status: "compensated" | "protected"; reason: string | null }> {
  execution.assertActive();
  const input = NativeCompensationActivityInputSchema.parse(raw);
  try {
    await execute(initial, input, { execution, budget });
    return { status: "compensated", reason: null };
  } catch (error) {
    execution.assertActive();
    const reason = compensationProtectionReason(error);
    if (reason === null) throw error;
    await initial.files.db.nativePublicationCompensationContinuation.updateMany(
      {
        where: {
          id: input.continuationId,
          coordinatorOperationId: input.operationId,
          recoveryEpoch: input.recoveryEpoch,
          state: { not: "compensated" },
        },
        data: { state: "protected", version: { increment: 1 } },
      },
    );
    execution.assertActive();
    return { status: "protected", reason };
  }
}

function compensationProtectionReason(error: unknown) {
  if (error instanceof NativeCompensationProtection) return error.reason;
  if (error instanceof NativeArchiveScopeProtection)
    return "compensation_authority_scope_exceeds_limit";
  if (error instanceof PendingLegacyClaimsError)
    return "compensation_legacy_claims_unresolved";
  if (error instanceof FileOperationConflict)
    return "compensation_physical_identity_protected";
  return error instanceof FileGuardError ? error.reason : null;
}
