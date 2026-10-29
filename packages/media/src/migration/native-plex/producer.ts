import type { MediaAutomationContext } from "#automation/context.ts";
import type { QbittorrentClient } from "#integrations/qbittorrent.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import type { NativeQuarantineObserverContext } from "#migration/native-network/quarantine.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import type { PlexAccess } from "#shared/plex-binding/contract.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  loadNativePlexReviewParent,
  loadNativePlexExecutionParent,
} from "#infrastructure/plex-binding/native/native-parent.ts";
import { loadNativePlexExecutionSnapshot } from "#infrastructure/plex-binding/native/native-execution-parent.ts";
import { readNativePlexCanonicalTargets } from "#infrastructure/plex-binding/canonical.ts";
import {
  persistNativeExecutionPlexProofBatch,
  persistReviewedNativePlexProofBatch,
} from "#infrastructure/plex-binding/native/native-commit.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import {
  assertCanonicalIdentity,
  assertWritersQuiescent,
} from "#migration/native-network/evidence.ts";
import { observeNativeTorrents } from "#migration/native-network/torrents.ts";
import { observeSupersededCoordinators } from "#migration/native-archive/coordinators.ts";
import { previousCoordinator } from "#migration/native-compensation/evidence.ts";
import { associationHash } from "#automation/publication/association/projection.ts";
import { prepareNativeCatalog } from "./scope.ts";
import { scanNativePlex, finishNativePlex } from "./observation.ts";
import { nativeNetworkEvidence } from "./network-evidence.ts";
import { nativePlexDeadline, nativeReviewPlexDeadline } from "./deadline.ts";
import { lockNativeReview } from "./authority.ts";
import { ArchiveReceiptProjection } from "#infrastructure/native-archive/receipt-projection.ts";
import type { NativeReceiptReadPort } from "#infrastructure/plex-binding/native/receipt-port.ts";

export type NativePlexContext = NativeQuarantineObserverContext &
  Pick<MediaAutomationContext, "plex" | "plexAccess" | "describeWorkflow"> & {
    qbittorrent: Pick<QbittorrentClient, "login" | "listAll">;
  };
type Command =
  { planId: string; operationId: string } | { operationId: string };

/** New v3 only. Dispatch/immutable ACK runs before entering this fresh observation path. */
export async function observeNativePlex(
  context: NativePlexContext,
  command: Command,
  execution: PlexBindingExecution,
  budget: PublicationAuthorityReadBudget,
) {
  let freshness = plexBindingFreshness({ ...execution, guards: [execution] });
  const active = {
    ...execution,
    assertActive: () => {
      freshness.assertActive();
    },
  };
  const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
    active.assertActive();
    const value = await work();
    active.assertActive();
    return value;
  };
  const locate = async (
    tx: Prisma.TransactionClient,
    projection?: NativeReceiptReadPort,
  ) => {
    if ("planId" in command) {
      const loaded = await loadNativePlexReviewParent(tx, command, budget);
      return { ...loaded, scope: loaded.parent.scope };
    }
    return loadNativePlexExecutionParent(tx, command, budget, projection);
  };
  const load = async (
    tx: Prisma.TransactionClient,
    projection?: NativeReceiptReadPort,
  ) => {
    if ("planId" in command) {
      const loaded = await loadNativePlexReviewParent(tx, command, budget);
      const snapshot = await lockNativeReview(
        tx,
        loaded.proofParent,
        loaded.parent.scope,
        budget,
      );
      return {
        ...loaded,
        scope: snapshot.scope,
        snapshot,
        executionSnapshot: null,
      };
    }
    const { snapshot: executionSnapshot, ...loaded } =
      await loadNativePlexExecutionSnapshot(tx, command, budget, projection);
    return { ...loaded, snapshot: null, executionSnapshot };
  };
  // Review discovery selects requested configuration only; it grants no effects.
  const original = await guarded(() =>
    context.db.$transaction((tx) =>
      locate(tx, new ArchiveReceiptProjection(tx, budget)),
    ),
  );
  const scopeHash = associationHash(original.scope);
  const assertOriginal = (
    current: Pick<Awaited<ReturnType<typeof load>>, "scope" | "proofParent">,
  ) => {
    if (
      associationHash(current.proofParent) !==
        associationHash(original.proofParent) ||
      associationHash(current.scope) !== scopeHash
    )
      throw new Error("Native paired proof scope changed during observation");
  };
  const kinds = [
    ...new Set(
      original.scope.files.map((file) =>
        file.libraryKind === "movies" ? ("movie" as const) : ("show" as const),
      ),
    ),
  ].sort();
  const access: PlexAccess[] = [];
  for (const kind of kinds)
    access.push(await guarded(() => context.plexAccess(kind)));
  const prepared = await guarded(() =>
    context.db.$transaction(async (tx) => {
      // This is the first full review authority phase, after configuration discovery.
      const current =
        original.proofParent.purpose === "native_review"
          ? await load(tx)
          : { ...original, snapshot: null };
      assertOriginal(current);
      const canonicalTargets = await readNativePlexCanonicalTargets(
        tx,
        current.scope,
      );
      const catalog = await prepareNativeCatalog(tx, {
        scope: original.scope,
        rawScope: original.rawScope,
        scopeHash: original.proofParent.scopeHash,
        canonicalTargets,
        access,
      });
      const roots =
        current.snapshot === null
          ? await assertNativeStorageRoots(
              tx,
              current.scope.storageRoots,
              budget,
            )
          : current.snapshot.scope.storageRoots;
      const deadline =
        original.proofParent.purpose === "native_execution"
          ? await nativePlexDeadline(tx, {
              execution,
              recoveryEpoch: original.proofParent.recoveryEpoch,
              previous: freshness,
            })
          : freshness;
      return { catalog, roots, deadline };
    }),
  );
  freshness = prepared.deadline;
  const signal = AbortSignal.any([
    execution.signal,
    AbortSignal.timeout(Math.max(1, freshness.expiresAtMs - Date.now())),
  ]);
  const quiescence = QuiescenceEvidenceSchema.parse(
    await guarded(() => context.observer.observe(signal)),
  );
  assertWritersQuiescent(quiescence);
  const mounts = CanonicalMountEvidenceSchema.parse(
    await guarded(() => context.observer.observeCanonicalMounts(signal)),
  );
  assertCanonicalIdentity(mounts, prepared.roots);
  const reviewParent =
    original.proofParent.purpose === "native_review"
      ? original.proofParent
      : null;
  freshness =
    reviewParent === null
      ? plexBindingFreshness({
          observed: execution.observed,
          expiresAtMs: Math.min(
            freshness.expiresAtMs,
            Date.parse(quiescence.expiresAt),
            Date.parse(mounts.expiresAt),
          ),
          guards: [prepared.deadline],
        })
      : await guarded(() =>
          context.db.$transaction((tx) =>
            nativeReviewPlexDeadline(tx, {
              parent: reviewParent,
              execution,
              previous: freshness,
              quiescence,
              mounts,
              roots: prepared.roots,
            }),
          ),
        );
  await guarded(() => context.qbittorrent.login(signal));
  const torrents = await guarded(() =>
    observeNativeTorrents({
      torrents: original.scope.torrents,
      qbittorrent: context.qbittorrent,
      signal,
    }),
  );
  const scope = original.scope;
  const supersededCoordinators =
    scope.schemaVersion === 2 && scope.lifecycleKind === "superseded_archive"
      ? await guarded(() =>
          observeSupersededCoordinators(context, scope, active),
        )
      : undefined;
  const previousWorkflowClosed =
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "publication_compensation"
      ? await guarded(() => previousCoordinator(context, scope, active))
      : null;
  const associationContext = {
    plex: context.plex,
    execution: { ...active, signal },
    freshness,
  };
  const scanned = await scanNativePlex(associationContext, prepared.catalog);
  const finished = await finishNativePlex(associationContext, {
    scope,
    catalog: prepared.catalog,
    parent: original.proofParent,
    scanned,
    observed: execution.observed,
  });
  const networkEvidence = nativeNetworkEvidence({
    parent: original.proofParent,
    scope,
    catalog: prepared.catalog,
    scanned,
    finished,
    quiescence,
    mounts,
    torrents,
    supersededCoordinators,
    previousWorkflowClosed,
  });
  return guarded(() =>
    context.db.$transaction(async (tx) => {
      const projection = new ArchiveReceiptProjection(tx, budget);
      const current = await load(tx, projection);
      assertOriginal(current);
      assertWritersQuiescent(quiescence);
      const roots =
        current.snapshot === null
          ? await assertNativeStorageRoots(tx, scope.storageRoots, budget)
          : current.snapshot.scope.storageRoots;
      assertCanonicalIdentity(mounts, roots);
      const finalFreshness =
        original.proofParent.purpose === "native_review"
          ? await nativeReviewPlexDeadline(tx, {
              parent: original.proofParent,
              execution,
              previous: freshness,
              quiescence,
              mounts,
              roots,
            })
          : await nativePlexDeadline(tx, {
              execution,
              recoveryEpoch: original.proofParent.recoveryEpoch,
              previous: freshness,
            });
      // A newly shortened authority cannot certify evidence carrying a later expiry.
      if (finalFreshness.expiresAtMs !== freshness.expiresAtMs)
        throw new Error("Native paired proof authority deadline changed");
      const proof = {
        parent: original.proofParent,
        networkEvidence,
        plexObservation: finished.observation,
        timing: finished.timing,
        expectedOperationResultHash: original.expectedOperationResultHash,
      };
      return current.snapshot === null
        ? persistNativeExecutionPlexProofBatch(tx, proof, {
            freshness: finalFreshness,
            budget,
            projection,
            executionSnapshot: current.executionSnapshot,
          })
        : persistReviewedNativePlexProofBatch(tx, proof, {
            snapshot: current.snapshot,
            freshness: finalFreshness,
            budget,
          });
    }),
  );
}
