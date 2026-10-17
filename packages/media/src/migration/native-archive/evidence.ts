import type { NativeArchiveExecution } from "#automation/native-archive/execution.ts";
import {
  archiveAwait,
  assertArchiveActive,
} from "#automation/native-archive/execution.ts";
import type { NativeQuarantineObserverContext } from "#migration/native-network/quarantine.ts";
import {
  NativeArchiveNetworkEvidenceSchema,
  type NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import { QuiescenceEvidenceSchema } from "#shared/legacy-observer.ts";
import { CanonicalMountEvidenceSchema } from "#shared/canonical-storage.ts";
import {
  assertCanonicalIdentity,
  assertWritersQuiescent,
} from "#migration/native-network/evidence.ts";
import { assertNativeStorageRoots } from "#infrastructure/native-recovery/storage-provenance.ts";
import { observeNativeTorrents } from "#migration/native-network/torrents.ts";
import { observeArchivePlex } from "./plex.ts";

export type NativeArchiveObserverContext = NativeQuarantineObserverContext & {
  archiveExecution: () => NativeArchiveExecution;
};

/** IO only; callers bind the complete immutable selection before and after this observation. */
export async function observeArchiveEvidence(
  context: NativeArchiveObserverContext,
  input: { planId: string; recoveryEpoch: number; scope: NativeArchiveScope },
  execution: NativeArchiveExecution,
) {
  assertArchiveActive(execution);
  const capturedAt = new Date();
  const signal = AbortSignal.any([
    execution.signal,
    AbortSignal.timeout(60_000),
  ]);
  const roots = await archiveAwait(
    execution,
    assertNativeStorageRoots(context.db, input.scope.storageRoots),
  );
  const quiescence = QuiescenceEvidenceSchema.parse(
    await archiveAwait(execution, context.observer.observe(signal)),
  );
  assertWritersQuiescent(quiescence);
  const mounts = CanonicalMountEvidenceSchema.parse(
    await archiveAwait(
      execution,
      context.observer.observeCanonicalMounts(signal),
    ),
  );
  assertCanonicalIdentity(mounts, roots);
  const [plex, torrents] = await archiveAwait(
    execution,
    Promise.all([
      observeArchivePlex(context, input.scope, signal),
      observeNativeTorrents({
        torrents: input.scope.torrents,
        qbittorrent: context.qbittorrent,
        signal,
      }),
    ]),
  );
  signal.throwIfAborted();
  const expiresAt = new Date(
    Math.min(
      Date.parse(quiescence.expiresAt),
      Date.parse(mounts.expiresAt),
      capturedAt.getTime() + 90_000,
    ),
  );
  return NativeArchiveNetworkEvidenceSchema.parse({
    schemaVersion: 2,
    lifecycleKind: "superseded_archive",
    planId: input.planId,
    recoveryEpoch: input.recoveryEpoch,
    capturedAt: capturedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    quiescence,
    mounts,
    plex,
    torrents,
  });
}
