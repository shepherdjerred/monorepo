import { z } from "zod";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import type { MediaAutomationContext } from "./context.ts";
import type { PlexBindingExecution } from "#shared/plex-binding/activities.ts";
import { readPlexRestorationParent } from "#infrastructure/plex-binding/restoration.ts";
import { plexBindingFreshness } from "#infrastructure/plex-binding/freshness.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import { commitVerifiedPlexBindings } from "#infrastructure/plex-binding/commit.ts";
import { lockPlexBindingScope } from "#infrastructure/plex-binding/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  readCompletedAcquisitionPlexPublication,
  recordCompletedAcquisitionPlexPublication,
} from "#infrastructure/plex-binding/publication-receipt.ts";
import type { AcquisitionPlexPublicationInput } from "#shared/plex-binding/publication.ts";
import {
  preparePublicationBindingExpected,
  verifyPublicationBinding,
  assertPublicationSelection,
  acquisitionPublicationParent,
  rollbackPublicationParent,
  type PublicationBindingSource,
} from "./publication/binding.ts";
import { serializable } from "./store.ts";
import { publicationAwait } from "./publication/execution.ts";
import { verifiedPublicationItems } from "./publication/verified.ts";
import { findPublished, publicationSections } from "./publication/plex.ts";
import { publicationMatchesReceipt } from "./publication/receipt.ts";
import {
  beforePublicationRefresh,
  assertPublicationCommitAuthority,
} from "./publication/fence.ts";
import { MovieChoiceProtection } from "#infrastructure/movie-editions/errors.ts";
import { NativeCompensationProtection } from "#infrastructure/native-compensation/protection.ts";
import { finalize } from "./publication/finalization.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { defaultScope, assertDefaultEdition } from "#shared/editions/scope.ts";
import { requireActiveRuntime } from "./runtime.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import { recordVerifiedPublication } from "./reconciliation/upgrade-cleanup.ts";
import { publishRollback } from "./reconciliation/rollback-publication.ts";
import { queuePublicationNotifications } from "./notifications/events.ts";
import { queueSharedPublication } from "./notifications/shared.ts";
import { nativeRestorePublication } from "#infrastructure/native-quarantine/publication.ts";
import {
  publicationCoverageInclude,
  publicationLineageResolved,
  publicationGenerationMatches,
  samePublicationEvidence,
  assertDefaultPublicationCoverage,
} from "./reconciliation/publication-evidence.ts";

type PublicationActivities = Pick<
  MediaNetworkActivities,
  | "publishMediaToPlex"
  | "publishRolledBackMedia"
  | "publishRestoredMedia"
  | "finalizeMediaAcquisition"
>;

export function createPublicationActivities(
  context: MediaAutomationContext,
  execution: () => PlexBindingExecution = context.plexBindingExecution,
): PublicationActivities {
  return {
    publishRolledBackMedia: async (input) => {
      const invocation = execution();
      const budget = new PublicationAuthorityReadBudget();
      invocation.assertActive();
      return publishRollback(context, input, (mediaIds, proof) =>
        publishCoverage(context, mediaIds, input.operationId, {
          ...proof,
          binding: {
            execution: invocation,
            budget,
            parent: (tx) => rollbackPublicationParent(tx, input.attemptId),
          },
        }),
      );
    },
    async publishRestoredMedia(input) {
      const invocation = execution();
      const budget = new PublicationAuthorityReadBudget();
      invocation.assertActive();
      const intent = await context.db.mediaIntent.findUniqueOrThrow({
        where: targetWhere(defaultScope(input.mediaId)),
      });
      if (intent.generation !== input.generation)
        return { status: "blocked", reason: "intent_changed" };
      const operation = await context.db.operation.findUniqueOrThrow({
        where: { id: input.operationId },
      });
      if (operation.kind === "restore_native_quarantine") {
        const restored = z
          .object({ restoreReceipt: z.unknown() })
          .parse(operation.result);
        const receipt = await nativeRestorePublication(
          context.db,
          operation.id,
          restored.restoreReceipt,
          budget,
        );
        if (!receipt.mediaIds.includes(input.mediaId))
          throw new Error("Native restore receipt omitted requested media");
        return publishCoverage(context, receipt.mediaIds, input.operationId, {
          epoch: receipt.recoveryEpoch,
          receipt,
          requiredGenerations: receipt.generations,
          binding: {
            execution: invocation,
            budget,
            parent: async (tx) => {
              const restoration = await readPlexRestorationParent(
                tx,
                operation.id,
                budget,
              );
              return restoration.parent;
            },
          },
        });
      }
      const receipt = RestoreReceiptSchema.parse(
        operation.result,
      ).restoreReceipt;
      if (!receipt.mediaIds.includes(input.mediaId))
        throw new Error("Restore receipt does not cover requested media");
      const decision = await context.db.retentionDecision.findUniqueOrThrow({
        where: { id: receipt.decisionId },
      });
      assertDefaultEdition(decision.edition);
      const runtime = await requireActiveRuntime(context.db);
      return decision.state !== "restored" ||
        !runtime.active ||
        runtime.epoch !== receipt.recoveryEpoch
        ? { status: "blocked", reason: "restore_evidence_obsolete" }
        : publishCoverage(context, receipt.mediaIds, input.operationId, {
            epoch: receipt.recoveryEpoch,
            receipt,
            binding: {
              execution: invocation,
              budget,
              parent: async (tx) => {
                const restoration = await readPlexRestorationParent(
                  tx,
                  operation.id,
                  budget,
                );
                return restoration.parent;
              },
            },
          });
    },
    async publishMediaToPlex(input) {
      const invocation = execution();
      const budget = new PublicationAuthorityReadBudget();
      invocation.assertActive();
      const completed = await context.db.$transaction((tx) =>
        readCompletedAcquisitionPlexPublication(tx, input, budget),
      );
      invocation.assertActive();
      if (completed !== null) return completed;
      const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
      });
      assertDefaultEdition(attempt.edition);
      return publishCoverage(context, attempt.mediaIds, input.operationId, {
        epoch: attempt.recoveryEpoch,
        acquisitionCompletion: input,
        notificationAttemptId: attempt.id,
        binding: {
          execution: invocation,
          budget,
          parent: (tx) => acquisitionPublicationParent(tx, attempt.id),
        },
        requiredGenerations: z
          .record(z.string(), z.number().int().nonnegative())
          .parse(attempt.generations),
      });
    },
    async finalizeMediaAcquisition(input) {
      await finalize(context, input.attemptId);
    },
  };
}

const RestoreReceiptSchema = z.object({
  restoreReceipt: z.object({
    decisionId: z.string(),
    mediaIds: z.array(z.string()).min(1),
    recoveryEpoch: z.number().int(),
    assets: z
      .array(
        z.object({
          assetId: z.string(),
          assetVersion: z.number().int(),
          checksum: z.string(),
        }),
      )
      .min(1),
  }),
});

type PublicationProof = {
  epoch: number;
  binding: PublicationBindingSource;
  notificationAttemptId?: string;
  receipt?: Pick<
    z.infer<typeof RestoreReceiptSchema>["restoreReceipt"],
    "mediaIds" | "assets"
  >;
  requiredGenerations?: Readonly<Record<string, number>>;
  releaseAttemptId?: string;
  acquisitionCompletion?: AcquisitionPlexPublicationInput;
};

export async function publishCoverage(
  context: MediaAutomationContext,
  mediaIds: string[],
  operationId: string,
  proof: PublicationProof,
): ReturnType<PublicationActivities["publishMediaToPlex"]> {
  try {
    return await publishCoverageChecked(context, mediaIds, operationId, proof);
  } catch (error) {
    if (
      error instanceof NativeCompensationProtection ||
      error instanceof PlexBindingProtection
    )
      return { status: "blocked", reason: error.reason };
    if (error instanceof MovieChoiceProtection)
      return { status: "blocked", reason: error.code };
    throw error;
  }
}

function publicationRuntimeReason(
  runtime: Awaited<ReturnType<typeof requireActiveRuntime>>,
  epoch: number,
): string | null {
  if (!runtime.active) return "runtime_observe";
  return runtime.epoch === epoch ? null : "recovery_epoch_changed";
}

async function publishCoverageChecked(
  context: MediaAutomationContext,
  mediaIds: string[],
  operationId: string,
  proof: PublicationProof,
): ReturnType<PublicationActivities["publishMediaToPlex"]> {
  const invocation = proof.binding.execution;
  const compensation = proof.binding.compensation;
  let freshness = plexBindingFreshness({
    observed: invocation.observed,
    expiresAtMs: invocation.expiresAtMs,
    guards: [
      invocation,
      ...(compensation === undefined ? [] : [compensation.execution]),
    ],
  });
  const execution = {
    get expiresAtMs() {
      return freshness.expiresAtMs;
    },
    signal: invocation.signal,
    assertActive: () => {
      freshness.assertActive();
    },
    checkpoint: (_phase: string) => invocation.checkpoint(),
  };
  await publicationAwait(execution, async () => compensation?.beforeNetwork());
  const runtime = await requireActiveRuntime(context.db);
  const runtimeReason = publicationRuntimeReason(runtime, proof.epoch);
  if (runtimeReason !== null)
    return { status: "blocked", reason: runtimeReason };
  const { receipt } = proof;
  const coverages = await context.db.assetCoverage.findMany({
    where: { mediaId: { in: mediaIds }, current: true, edition: "default" },
    include: publicationCoverageInclude,
  });
  if (coverages.length === 0)
    return { status: "blocked", reason: "published_asset_missing" };
  assertDefaultPublicationCoverage(coverages);
  if (coverages.some((coverage) => !publicationLineageResolved(coverage)))
    return { status: "blocked", reason: "lineage_unresolved" };
  if (
    !(await recordsAuthorized(context.db, {
      epoch: runtime.epoch,
      mediaIds,
      assetIds: coverages.map((item) => item.assetId),
    }))
  )
    return { status: "blocked", reason: "record_ownership_unconfirmed" };
  if (
    !coverages.every(
      (coverage) =>
        proof.requiredGenerations === undefined ||
        publicationGenerationMatches(coverage, proof.requiredGenerations),
    )
  )
    return { status: "blocked", reason: "rollback_intent_changed" };
  if (!publicationMatchesReceipt(coverages, receipt))
    return { status: "blocked", reason: "restore_evidence_obsolete" };
  const prepared = await preparePublicationBindingExpected(context, {
    mediaIds,
    source: proof.binding,
    freshness,
  });
  const kind = coverages[0]?.media.kind === "movie" ? "movie" : "episode";
  const sections = await publicationSections(context, kind, execution);
  const section = sections[0];
  if (section === undefined || sections.length !== 1)
    return { status: "blocked", reason: "plex_section_ambiguous" };
  if (
    prepared.access.length !== 1 ||
    prepared.access[0]?.sectionId !== section.key
  )
    throw new PlexBindingProtection("wrong_section");
  const refreshAuthority = await publicationAwait(execution, () =>
    beforePublicationRefresh(context, prepared, compensation),
  );
  // Retain the earliest actually consumed lease/choice bound through scans and COMMIT.
  freshness = refreshAuthority;
  await publicationAwait(execution, () => {
    refreshAuthority.assertActive();
    return context.plex.refresh(section.key, execution.signal);
  });
  const items = await findPublished(context, {
    sectionId: section.key,
    kind,
    paths: new Set(coverages.map((coverage) => coverage.asset.path)),
    operationId,
    execution,
    scope:
      proof.releaseAttemptId === undefined
        ? "publication"
        : `rollback:${proof.releaseAttemptId}`,
  });
  if (
    items.size !==
    new Set(coverages.map((coverage) => coverage.asset.path)).size
  )
    return { status: "waiting", reason: "plex_scan_pending" };
  const binding = await verifyPublicationBinding(context, {
    ...prepared,
    freshness,
  });
  const matched = await verifiedPublicationItems(context, {
    coverages,
    items,
    sectionId: section.key,
    compensation: compensation !== undefined,
    execution,
    binding: binding.verified,
  });
  const { verified, compensationItems } = matched;
  if (
    new Set(compensationItems.map((item) => item.ratingKey)).size !==
    compensationItems.length
  )
    return { status: "blocked", reason: "plex_identity_ambiguous" };
  assertPublicationSelection({
    selected: verified,
    sectionId: section.key,
    binding,
  });
  const shared =
    proof.notificationAttemptId === undefined
      ? undefined
      : await context.sharedAnnouncements?.();
  freshness.assertActive();
  await publicationAwait(execution, () =>
    serializable(context.db, async (tx) => {
      const budget = binding.source.budget;
      const compensationPhase = await compensation?.loadPhase(tx, budget);
      await publicationAwait(execution, () =>
        lockPlexBindingScope(
          tx,
          binding.lockScope,
          binding.verified.freshness,
          { compensationPhase, budget },
        ),
      );
      await assertPublicationCommitAuthority(tx, {
        epoch: runtime.epoch,
        mediaIds,
        assetIds: coverages.map((item) => item.assetId),
      });
      for (const snapshot of coverages) {
        const current = await tx.assetCoverage.findUniqueOrThrow({
          where: {
            assetId_mediaId: {
              assetId: snapshot.assetId,
              mediaId: snapshot.mediaId,
            },
          },
          include: publicationCoverageInclude,
        });
        if (!samePublicationEvidence(current, snapshot))
          throw new Error("Publication evidence changed before commit");
      }
      for (const entry of verified) {
        const stillCurrent = await tx.assetCoverage.findUniqueOrThrow({
          where: {
            assetId_mediaId: { assetId: entry.assetId, mediaId: entry.mediaId },
          },
        });
        if (!stillCurrent.current || stillCurrent.edition !== "default")
          throw new Error("Publication asset changed during Plex verification");
        await tx.mediaItem.update({
          where: { id: entry.mediaId },
          data: {
            externalIds: {
              ...entry.externalIds,
              plexRatingKey: entry.ratingKey,
              plexSectionId: section.key,
            },
            availability: "available",
          },
        });
        await mirrorDefaultAvailability(tx, [entry.mediaId], "available");
      }
      const bindings = await commitVerifiedPlexBindings(
        tx,
        {
          expected: binding.expected,
          verified: binding.verified,
        },
        budget,
        compensationPhase,
      );
      if (compensation === undefined)
        await recordVerifiedPublication(
          tx,
          verified.map((entry) => entry.assetId),
          runtime.epoch,
        );
      if (compensation !== undefined) {
        if (compensationPhase === undefined)
          throw new Error(
            "Compensated publication commit requires its fresh transaction phase",
          );
        await compensation.commitVerified(tx, {
          items: compensationItems,
          phase: compensationPhase,
          freshness: binding.verified.freshness,
          budget,
        });
      }
      if (proof.notificationAttemptId !== undefined) {
        await queuePublicationNotifications(tx, proof.notificationAttemptId);
        if (shared !== undefined)
          await queueSharedPublication(tx, proof.notificationAttemptId, shared);
      }
      if (proof.releaseAttemptId !== undefined)
        await tx.acquisitionReservation.deleteMany({
          where: { attemptId: proof.releaseAttemptId, edition: "default" },
        });
      if (proof.acquisitionCompletion !== undefined)
        await recordCompletedAcquisitionPlexPublication(
          tx,
          {
            input: proof.acquisitionCompletion,
            expected: binding.expected,
            bindings,
            verified: binding.verified,
          },
          budget,
        );
      execution.signal.throwIfAborted();
      execution.assertActive();
      binding.verified.freshness.assertActive();
    }),
  );
  return { status: "available", reason: null };
}
