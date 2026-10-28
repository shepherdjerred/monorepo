import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import {
  FileGuardError,
  type FilePlanEntry,
  type Transaction,
} from "#automation/files/types.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { lockPublicationRows } from "#infrastructure/publication-proof/locks.ts";
import {
  createPublicationIntent,
  loadPublicationIntent,
  commitPublicationOutcome,
} from "#infrastructure/publication-proof/store.ts";
import { snapshotPublicationAsset } from "#infrastructure/publication-proof/snapshots.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { importDescriptor } from "#automation/files/inspection.ts";
import { capturePublicationIntent } from "./intent.ts";
import {
  assertPublicationActive,
  type PublicationContext,
} from "./invocation.ts";
import { publicationAuthorityGuard } from "./authority.ts";
import {
  preparePublicationStores,
  publicationRecording,
  withPublicationPaths,
} from "./recording.ts";
import { observePublicationParticipants } from "./participants.ts";
import type { PublicationIOIntentRef } from "#shared/publication-proof/io.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";
import type {
  PublicationEffectRef,
  PublicationJournal,
} from "#shared/publication-proof/effects.ts";

export type PublicationProducer = {
  context: PublicationContext;
  attempt: AcquisitionAttempt;
  plan: readonly FilePlanEntry[];
  rawFilePlanHash: string;
  authorizePlan: (
    tx: Transaction,
    current: AcquisitionAttempt,
  ) => Promise<() => void>;
  authorizeEntry: (
    tx: Transaction,
    current: AcquisitionAttempt,
    entry: FilePlanEntry,
  ) => Promise<void>;
  /** Optional protocol-specific recapture after physical rows are locked. */
  authorizeLockedPlan?: (
    tx: Transaction,
    current: AcquisitionAttempt,
  ) => Promise<void>;
  commit: (tx: Transaction, entry: FilePlanEntry) => Promise<void>;
};

export type PublicationOutcomeData<Asset> = {
  kind: "published";
  transitionId: string;
  intentHash: string;
  filePlanHash: string;
  birthEpoch: number;
  effects: PublicationEffectRef[];
  entries: {
    entryOperationId: string;
    predecessor: Asset | null;
    successor: Asset;
    participants: PublicationParticipant[];
    journals: PublicationJournal[];
  }[];
  completedAt: string;
};
export type PublicationProtocol<
  Asset,
  Parent extends PublicationIOIntentRef,
> = {
  lockScope: (tx: Transaction, mediaIds: string[]) => Promise<void>;
  load: (tx: Transaction, attemptId: string) => Promise<Parent | null>;
  capture: (
    tx: Transaction,
    attempt: AcquisitionAttempt,
    transitionId: string,
  ) => Promise<Parent>;
  snapshot: (tx: Transaction, assetId: string) => Promise<Asset>;
  complete: (
    tx: Transaction,
    parent: Parent,
    outcome: PublicationOutcomeData<Asset>,
  ) => Promise<void>;
};

/** The durable intent commits independently before the first publication syscall. */
export async function producePublication(
  input: PublicationProducer,
): Promise<void> {
  await producePublicationWithProtocol(input, {
    lockScope: lockAcquisitionMedia,
    load: (tx, attemptId) =>
      loadPublicationIntent(
        tx,
        attemptId,
        input.context.libraryManagement?.budget,
      ),
    capture: async (tx, attempt, transitionId) => {
      const captured = await capturePublicationIntent(tx, {
        context: input.context,
        attempt,
        plan: input.plan,
        transitionId,
        rawFilePlanHash: input.rawFilePlanHash,
      });
      assertPublicationActive(input.context);
      const result = await createPublicationIntent(
        tx,
        captured,
        input.context.libraryManagement?.budget,
      );
      assertPublicationActive(input.context);
      return result;
    },
    snapshot: (tx, assetId) =>
      snapshotPublicationAsset(
        tx,
        assetId,
        input.context.libraryManagement?.budget,
      ),
    complete: async (tx, parent, outcome) => {
      await commitPublicationOutcome(
        tx,
        {
          intent: parent,
          outcome: { schemaVersion: 1, ...outcome },
        },
        input.context.libraryManagement?.budget,
      );
    },
  });
}

/** Shared original filesystem/WAL sequence; versioned protocols validate and persist their own literal parents. */
export async function producePublicationWithProtocol<
  Asset,
  Parent extends PublicationIOIntentRef,
>(
  input: PublicationProducer,
  protocol: PublicationProtocol<Asset, Parent>,
): Promise<void> {
  const { context, attempt, plan } = input;
  assertPublicationActive(context);
  const existing = await protocol.load(context.db, attempt.id);
  const transitionId = existing?.transitionId ?? crypto.randomUUID();
  const stores = await preparePublicationStores(context, {
    transitionId,
    plan,
  });
  const intent = await context.db.$transaction(
    async (tx) => {
      const { current, assertAuthority } = await lockProducer(
        tx,
        input,
        protocol.lockScope,
      );
      const persisted = await protocol.load(tx, attempt.id);
      if (persisted !== null) {
        if (
          persisted.transitionId !== transitionId ||
          persisted.intent.filePlanHash !== input.rawFilePlanHash
        )
          throw new FileGuardError("publication_intent_changed");
        return persisted;
      }
      if (stores.some((item) => item.observed.records.length > 0))
        throw new FileGuardError("publication_effect_without_intent");
      const operations = stores.map(({ kind }) => ({
        kind,
        files: new FileOperations(context.roots[kind], {
          ...(context.contentProof === undefined
            ? {}
            : { contentProof: context.contentProof }),
          authorize: () => Promise.resolve(),
          ...(context.verifyPlexExclusion === undefined
            ? {}
            : { verifyPlexExclusion: context.verifyPlexExclusion }),
        }),
      }));
      return await withPublicationPaths(context, plan, operations, async () => {
        const result = await protocol.capture(tx, current, transitionId);
        assertAuthority();
        return result;
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
  await context.checkpoint("publication-intent-committed");
  const recording = publicationRecording(context, intent, stores);
  await context.db.$transaction(
    async (tx) => {
      const { current, assertAuthority } = await lockProducer(
        tx,
        input,
        protocol.lockScope,
      );
      for (const store of stores) {
        const physicalAuthority = await publicationAuthorityGuard(tx, context, {
          libraryKind: store.kind,
          recoveryEpoch: current.recoveryEpoch,
        });
        store.bindAuthority(() => {
          assertAuthority();
          physicalAuthority();
        });
      }
      const operations = recording.operations((entry) =>
        input.authorizeEntry(tx, current, entry),
      );
      await withPublicationPaths(context, plan, operations, async () => {
        await recording.assertCurrent();
        for (const entry of plan) {
          const operationsForKind = operations.find(
            (item) => item.kind === entry.libraryKind,
          );
          if (operationsForKind === undefined)
            throw new Error("Publication root executor missing");
          await input.authorizeEntry(tx, current, entry);
          for (const sidecar of entry.previousSidecars)
            await operationsForKind.files.quarantine({
              operationId: sidecar.operationId,
              libraryPath: sidecar.libraryPath,
              quarantineId: sidecar.quarantineId,
              sha256: sidecar.checksum,
            });
          await operationsForKind.files.importFile(importDescriptor(entry));
          await input.commit(tx, entry);
        }
        if (recording.state.next !== undefined)
          throw new FileGuardError("publication_effects_incomplete");
        await recording.assertCurrent();
        await tx.acquisitionAttempt.update({
          where: { id: attempt.id },
          data: { state: "imported" },
        });
        const entries = [];
        for (const entry of plan)
          entries.push({
            entryOperationId: entry.operationId,
            predecessor:
              entry.previousAssetId === null
                ? null
                : await protocol.snapshot(tx, entry.previousAssetId),
            successor: await protocol.snapshot(tx, entry.assetId),
            participants: await observePublicationParticipants(
              context,
              entry,
              true,
            ),
            journals: [...recording.state.journals.entries()]
              .filter(([key]) => {
                const ids = [
                  entry.operationId,
                  ...entry.previousSidecars.map((item) => item.operationId),
                ];
                return ids.some(
                  (id) =>
                    key ===
                    JSON.stringify([entry.libraryKind, `journal/${id}.json`]),
                );
              })
              .map(([, journal]) => journal),
          });
        await protocol.complete(tx, intent, {
          kind: "published",
          transitionId: intent.transitionId,
          intentHash: intent.intentHash,
          filePlanHash: intent.intent.filePlanHash,
          birthEpoch: intent.intent.birthEpoch,
          effects: recording.state.refs,
          entries,
          completedAt: new Date().toISOString(),
        });
        await context.checkpoint("publication-before-commit");
        for (const store of stores) store.assertActive();
      });
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

async function lockProducer(
  tx: Transaction,
  input: PublicationProducer,
  lockScope: PublicationProtocol<unknown, PublicationIOIntentRef>["lockScope"],
) {
  assertPublicationActive(input.context);
  await lockScope(tx, input.attempt.mediaIds);
  const current = await tx.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attempt.id },
  });
  if (snapshotHash(nativeJson(current.filePlan)) !== input.rawFilePlanHash)
    throw new FileGuardError("publication_plan_changed");
  // Whole-plan claims/runtime/identity authority is transaction-local. Reacquire
  // it in both transactions, before entry profiles and physical row locks.
  const assertAuthority = await input.authorizePlan(tx, current);
  for (const entry of input.plan)
    await input.authorizeEntry(tx, current, entry);
  await lockPublicationRows(tx, {
    attemptId: input.attempt.id,
    mediaIds: input.attempt.mediaIds,
    entries: input.plan.map((entry) => ({ entry })),
  });
  await input.authorizeLockedPlan?.(tx, current);
  assertPublicationActive(input.context);
  assertAuthority();
  return { current, assertAuthority };
}
