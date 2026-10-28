import { fileMovieAccess } from "#automation/editions/access.ts";
import type { MovieChoiceFreshness } from "#infrastructure/movie-editions/freshness.ts";
import {
  FileGuardError,
  type FileContext,
  type RemovalEntry,
  type Transaction,
  now,
} from "./types.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
import { assertRetention, lockMedia } from "./guards.ts";
import {
  PendingLegacyClaimsError,
  reopenLegacyClaimProtection,
} from "#infrastructure/recovery/legacy-claims/protection.ts";
import { removalPlan, assertOwnedAsset } from "./removal-plan.ts";
import { advanceSubtitleBindings } from "./subtitle-lifecycle/ownership.ts";
import { fileOperations } from "./file-operations.ts";
import { z } from "zod";
import { prepareRemovalProof } from "./content-proof.ts";
import { queueLifecycleNotifications } from "#automation/notifications/events.ts";
import {
  awaitRetentionFreshness,
  RetentionEpochSchema,
  requireFreshRetentionStart,
} from "./retention-freshness.ts";
import {
  publicationInvocation,
  requirePublicationExecution,
} from "#automation/publication-proof/invocation.ts";
import { lockRemovalAuthority } from "./plex-binding/locks.ts";
import {
  captureRemovalQuarantineScopes,
  removalPlexAccess,
  readRetentionPlexAuthority,
} from "./plex-binding/retention.ts";
import {
  retentionPlexFreshness,
  removalEffectFreshness,
} from "./plex-binding/freshness.ts";
import {
  capturePlexQuarantineCommit,
  recordCommittedPlexQuarantine,
} from "#infrastructure/plex-binding/quarantine-commit.ts";

export async function removeFiles(
  initialContext: FileContext,
  decisionId: string,
  operationId: string,
  purge: boolean,
): Promise<void> {
  const observed = { wall: Date.now(), monotonic: performance.now() };
  const execution = initialContext.publicationExecution?.();
  execution?.assertActive();
  const enabled = purge
    ? initialContext.enabled.purge
    : initialContext.enabled.quarantine;
  if (!(await enabled())) throw new FileGuardError("retention_disabled");
  const snapshot = await initialContext.db.$transaction(async (tx) => {
    const decision = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: decisionId },
    });
    if (decision.edition !== "default")
      throw new FileGuardError("edition_not_available");
    await lockMedia(tx, [decision.mediaId]);
    const completed = decision.state === (purge ? "purged" : "quarantined");
    const epoch = RetentionEpochSchema.parse(decision.evidence).recoveryEpoch;
    if (!completed) {
      const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      if (runtime.recoveryEpoch !== epoch)
        throw new FileGuardError("runtime_protected");
      requireFreshRetentionStart(initialContext, decision.evidence);
    }
    return {
      plan: await removalPlan(tx, initialContext, decisionId),
      epoch,
      ownerOverride:
        z
          .object({ ownerOverride: z.unknown().optional() })
          .parse(decision.evidence).ownerOverride !== undefined,
      completed,
      evidence: decision.evidence,
    };
  });
  const { plan } = snapshot;
  if (snapshot.completed) return;
  const invocation = publicationInvocation(
    initialContext,
    requirePublicationExecution(execution),
  );
  const originalFreshness = snapshot.ownerOverride
    ? null
    : retentionPlexFreshness({
        context: invocation,
        observed,
        evidence: snapshot.evidence,
      });
  const access = snapshot.ownerOverride
    ? []
    : await removalPlexAccess(invocation, plan);
  originalFreshness?.assertActive();
  const quarantinedScopes =
    purge && originalFreshness !== null
      ? await captureRemovalQuarantineScopes(initialContext.db, {
          plan,
          access,
          freshness: originalFreshness,
        })
      : [];
  const mediaIds = [...new Set(plan.flatMap((entry) => entry.mediaIds))];
  const movieAccess = snapshot.ownerOverride
    ? undefined
    : await fileMovieAccess(initialContext, mediaIds);
  if (await reopenLegacyClaimProtection(initialContext.db, mediaIds))
    throw new PendingLegacyClaimsError(mediaIds);
  const context = await prepareRemovalProof(invocation, plan);
  originalFreshness?.assertActive();
  await awaitRetentionFreshness(context, {
    decisionId,
    plan,
    epoch: snapshot.epoch,
    purge,
    assertOriginal: originalFreshness?.assertActive,
  });
  originalFreshness?.assertActive();
  const completeState = purge ? "purged" : "quarantined";
  const previousSubtitleState = purge ? "quarantined" : "installed";
  await context.db.$transaction(
    async (tx) => {
      await lockRemovalAuthority(tx, {
        plan,
        epoch: snapshot.epoch,
        access,
        evidence: snapshot.evidence,
        quarantinedScopes,
      });
      const decision = await tx.retentionDecision.findUniqueOrThrow({
        where: { id: decisionId },
      });
      if (decision.state === completeState) return;
      const effectFreshness = await removalEffectFreshness(tx, {
        context: { ...context, execution: invocation.execution },
        plan,
        epoch: snapshot.epoch,
        observed,
        original: originalFreshness,
      });
      const plex = snapshot.ownerOverride
        ? undefined
        : await readRetentionPlexAuthority(tx, {
            plan,
            purge,
            access,
            freshness: effectFreshness,
          });
      const receipt =
        purge || snapshot.ownerOverride
          ? null
          : await capturePlexQuarantineCommit(
              tx,
              { operationId, decisionId, plan, access },
              effectFreshness,
            );
      const choices: MovieChoiceFreshness[] = [];
      for (const entry of plan) {
        const choice = await removeAuthorizedEntry(context, entry, {
          authorization: {
            tx,
            context,
            decisionId,
            mediaIds: entry.mediaIds,
            generations: entry.generations,
            purge,
            movieAccess,
            plex,
          },
          operationId,
          enabled,
          effectFreshness,
        });
        if (choice !== null) choices.push(choice);
      }
      await commitRemovalEntries(tx, {
        plan,
        epoch: snapshot.epoch,
        purge,
        completeState,
        previousSubtitleState,
      });
      const timestamp = now(context);
      await tx.retentionDecision.updateMany({
        where: {
          mediaId: { in: mediaIds },
          edition: "default",
          state: purge ? "quarantined" : "grace_period",
        },
        data: {
          state: completeState,
          manifest: { assets: plan },
          version: { increment: 1 },
          ...(purge
            ? {}
            : {
                quarantinedAt: timestamp,
                purgeAfter: new Date(timestamp.getTime() + 7 * 86_400_000),
              }),
        },
      });
      if (receipt !== null)
        await recordCommittedPlexQuarantine(
          tx,
          { expected: receipt },
          effectFreshness,
        );
      await tx.mediaItem.updateMany({
        where: { id: { in: mediaIds } },
        data: {
          availability: purge ? "removed" : "quarantined",
          version: { increment: 1 },
        },
      });
      await mirrorDefaultAvailability(
        tx,
        mediaIds,
        purge ? "removed" : "quarantined",
      );
      const evidence = z
        .object({ recoveryEpoch: z.number().int() })
        .parse(decision.evidence);
      const intents = await tx.mediaIntent.findMany({
        where: { mediaId: { in: mediaIds }, edition: "default" },
      });
      await queueLifecycleNotifications(tx, {
        key: `retention:${decisionId}:${completeState}`,
        kind: purge ? "files_purged" : "files_quarantined",
        epoch: evidence.recoveryEpoch,
        items: intents.map((intent) => ({
          mediaId: intent.mediaId,
          generation: intent.generation,
          decisionId,
        })),
      });
      for (const choice of choices) choice.assertActive();
      effectFreshness.assertActive();
    },
    { timeout: 30_000, maxWait: 30_000 },
  );
}

export async function commitRemovalEntries(
  tx: Transaction,
  input: {
    plan: readonly RemovalEntry[];
    epoch: number;
    purge: boolean;
    completeState: "purged" | "quarantined";
    previousSubtitleState: "quarantined" | "installed";
  },
) {
  for (const entry of input.plan) {
    await tx.libraryAsset.update({
      where: { id: entry.assetId },
      data: { state: input.completeState, version: { increment: 1 } },
    });
    await advanceSubtitleBindings(tx, {
      assetId: entry.assetId,
      checksum: entry.checksum,
      epoch: input.epoch,
      fromVersion: entry.assetVersion + (input.purge ? 1 : 0),
      toVersion: entry.assetVersion + (input.purge ? 2 : 1),
      fromState: input.previousSubtitleState,
      sidecarIds: entry.sidecars.map((item) => item.subtitleId),
      state: input.completeState,
    });
    if (input.purge)
      await tx.assetCoverage.updateMany({
        where: { assetId: entry.assetId },
        data: { current: false },
      });
  }
}

async function removeAuthorizedEntry(
  context: FileContext,
  entry: RemovalEntry,
  input: {
    authorization: Parameters<typeof assertRetention>[0];
    operationId: string;
    enabled: () => Promise<boolean>;
    effectFreshness: MovieChoiceFreshness;
  },
) {
  const choice: { current: MovieChoiceFreshness | null } = { current: null };
  const authorize = async () => {
    await context.checkpoint("retention-authorization");
    if (!(await input.enabled()))
      throw new FileGuardError("retention_disabled");
    choice.current = await assertRetention(input.authorization);
    await assertOwnedAsset(
      input.authorization.tx,
      entry,
      input.authorization.purge ? "quarantined" : "published",
    );
    choice.current?.assertActive();
    input.effectFreshness.assertActive();
  };
  await authorize();
  const operations = fileOperations(
    context,
    context.roots[entry.libraryKind],
    authorize,
    () => {
      choice.current?.assertActive();
      input.effectFreshness.assertActive();
    },
  );
  await removeEntry(
    operations,
    entry,
    input.operationId,
    input.authorization.purge,
  );
  return choice.current;
}

export async function removeEntry(
  operations: ReturnType<typeof fileOperations>,
  entry: RemovalEntry,
  operationId: string,
  purge: boolean,
): Promise<void> {
  for (const file of [...entry.sidecars, entry]) {
    const descriptor = {
      operationId: `${operationId}-${purge ? "purge" : "quarantine"}-${file.quarantineId}`,
      quarantineId: file.quarantineId,
      libraryPath: file.libraryPath,
      sha256: file.checksum,
    };
    if (purge) await operations.purge(descriptor);
    else await operations.quarantine(descriptor);
  }
}
