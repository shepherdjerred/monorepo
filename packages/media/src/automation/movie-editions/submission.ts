import { z } from "zod";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable, queueOperation } from "#automation/store.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireActiveRuntime } from "#automation/runtime.ts";
import { StoredCandidateSchema } from "#automation/providers.ts";
import {
  prepareTorrent,
  ownedTorrent,
  submitNew,
} from "#automation/acquisition-submission.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { authorizedMovieSubmissionV4 } from "./submission-authority.ts";
import { MediaError } from "#application/errors.ts";

async function prepareMovieTorrent(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  input: { source: ProviderCandidate; scope: MovieEditionScope },
) {
  const prepared = await prepareTorrent(context, input.source);
  if (prepared.reason !== null)
    return {
      status: prepared.wait ? ("waiting" as const) : ("blocked" as const),
      reason: prepared.reason,
    };
  const reason = await submitNew(context, attempt, input.source, {
    bytes: prepared.bytes,
    authorize: (_ctx, current, effect) =>
      authorizedMovieSubmissionV4(context, current, input.scope, effect),
  });
  return reason === null ? null : { status: "blocked" as const, reason };
}

export async function validMovieAttemptV4(
  context: MediaAutomationContext,
  raw: MovieAttemptOperationV4,
) {
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  return serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, input.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.scope.mediaId],
    });
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: input.attemptId },
    });
    if (!(await lockRuntimeAuthority(tx, current.recoveryEpoch))) return false;
    if (current.coordinatorOperationId !== input.operationId) return false;
    const authorized = await movieAttemptEffectAuthorityV4(
      tx,
      current,
      input.scope,
      access,
    );
    authorized?.freshness.assertActive();
    return authorized !== null;
  });
}

async function submissionPrerequisiteV4(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  input: MovieAttemptOperationV4,
): Promise<Awaited<
  ReturnType<MediaNetworkActivities["submitMediaTorrent"]>
> | null> {
  if (attempt.coordinatorOperationId !== input.operationId)
    return { status: "obsolete", reason: "coordinator_changed" };
  const runtime = await requireActiveRuntime(context.db);
  if (!runtime.active || runtime.epoch !== attempt.recoveryEpoch)
    return { status: "blocked", reason: "recovery_epoch_changed" };
  if (attempt.state === "imported")
    return { status: "submitted", reason: "resume_committed_publication" };
  const recovering =
    attempt.state === "submitting" || attempt.state === "submission_unknown";
  if (!recovering) {
    if (!(await context.gates.acquisition()))
      return { status: "blocked", reason: "acquisition_disabled" };
    if (!(await validMovieAttemptV4(context, input)))
      return { status: "obsolete", reason: "intent_changed" };
  }
  return null;
}

export async function submitMovieTorrentV4(
  context: MediaAutomationContext,
  raw: MovieAttemptOperationV4,
): ReturnType<MediaNetworkActivities["submitMediaTorrent"]> {
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { release: true, torrent: true },
  });
  await readMovieAttemptIdentityV4(context.db, attempt, input.scope);
  const prerequisite = await submissionPrerequisiteV4(context, attempt, input);
  if (prerequisite !== null) return prerequisite;
  const recovering =
    attempt.state === "submitting" || attempt.state === "submission_unknown";
  if (attempt.release.encryptedSource === null)
    throw new Error("Movie v4 attempt lost its encrypted provider source");
  const source = StoredCandidateSchema.parse(
    JSON.parse(
      context.cipher.decrypt(
        attempt.release.encryptedSource,
        `release:${attempt.release.providerId}:${attempt.release.providerReleaseId}`,
      ),
    ),
  );
  await context.qbittorrent.login();
  const existing = await context.qbittorrent.observe(source.infoHash);
  if (existing === null) {
    if (recovering)
      return { status: "blocked", reason: "submission_outcome_unknown" };
    const result = await prepareMovieTorrent(context, attempt, {
      source,
      scope: input.scope,
    });
    if (result !== null) return result;
  } else if (!ownedTorrent(context, existing, attempt))
    return { status: "blocked", reason: "torrent_ownership_conflict" };
  const observed = await context.qbittorrent.observe(source.infoHash);
  if (observed === null)
    return { status: "waiting", reason: "submission_visibility_pending" };
  return ownedTorrent(context, observed, attempt)
    ? registerMovieSubmissionV4(context, {
        attempt,
        scope: input.scope,
        source,
        observed,
      })
    : { status: "blocked", reason: "torrent_ownership_conflict" };
}

/** Recording a proven prior add preserves seeding responsibility even after current demand is cancelled. */
async function registerMovieSubmissionV4(
  context: MediaAutomationContext,
  input: {
    attempt: AcquisitionAttempt;
    scope: MovieEditionScope;
    source: ProviderCandidate;
    observed: TorrentObservation;
  },
): ReturnType<MediaNetworkActivities["submitMediaTorrent"]> {
  const { attempt, scope, source, observed } = input;
  const safe = hasApplicationSeedingPolicy(observed);
  const provider = await context.db.mediaProvider.findUniqueOrThrow({
    where: { id: source.providerId },
  });
  const recorded = await serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [scope.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return false;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (current.coordinatorOperationId !== attempt.coordinatorOperationId)
      return false;
    await readMovieAttemptIdentityV4(tx, current, scope);
    const torrent = await tx.torrent.upsert({
      where: { infoHash: source.infoHash },
      create: {
        infoHash: source.infoHash,
        qbittorrentId: observed.hash,
        providerId: source.providerId,
        owned: true,
        ownershipEpoch: current.recoveryEpoch,
        seedingPolicy: z
          .record(z.string(), z.json())
          .parse(provider.seedingPolicy),
        state: safe ? "downloading" : "policy_drift",
      },
      update: { qbittorrentId: observed.hash },
    });
    if (
      !torrent.owned ||
      torrent.ownershipEpoch !== current.recoveryEpoch ||
      torrent.providerId !== source.providerId
    )
      throw new Error(
        "Movie submission cannot adopt a torrent owned by another authority",
      );
    await tx.acquisitionAttempt.update({
      where: { id: current.id },
      data: {
        torrentId: torrent.id,
        ...(["reserved", "submitting", "submission_unknown"].includes(
          current.state,
        )
          ? { state: "submission_observed" }
          : {}),
      },
    });
    await queueOperation(tx, {
      key: `seed:${torrent.id}`,
      kind: "maintain_torrent",
      targetId: torrent.id,
      payload: { torrentId: torrent.id },
    });
    return true;
  });
  if (!recorded)
    return { status: "blocked", reason: "submission_authority_changed" };
  await projectRecordedMovieSubmissionV4(context, attempt, scope);
  return safe
    ? { status: "submitted", reason: null }
    : { status: "blocked", reason: "torrent_policy_drift" };
}

/** A separate transaction cannot roll back already recorded seeding responsibility when live consent expires. */
async function projectRecordedMovieSubmissionV4(
  context: MediaAutomationContext,
  snapshot: AcquisitionAttempt,
  scope: MovieEditionScope,
) {
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [scope.mediaId])) ?? {},
  );
  return serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [scope.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, snapshot.recoveryEpoch))) return;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: snapshot.id },
    });
    if (
      current.coordinatorOperationId !== snapshot.coordinatorOperationId ||
      current.torrentId === null ||
      ["validating", "imported"].includes(current.state)
    )
      return;
    let authorized: Awaited<ReturnType<typeof movieAttemptEffectAuthorityV4>>;
    try {
      authorized = await movieAttemptEffectAuthorityV4(
        tx,
        current,
        scope,
        access,
      );
    } catch (error) {
      if (!(error instanceof MediaError)) throw error;
      authorized = null;
    }
    await tx.acquisitionAttempt.update({
      where: { id: current.id },
      data: { state: authorized === null ? "cancelled" : "downloading" },
    });
    if (authorized !== null) {
      await tx.mediaIntent.update({
        where: {
          mediaId_edition: { mediaId: scope.mediaId, edition: scope.edition },
        },
        data: { availability: "downloading" },
      });
      if (scope.edition === "default")
        await tx.mediaItem.update({
          where: { id: scope.mediaId },
          data: { availability: "downloading" },
        });
      authorized.freshness.assertActive();
    }
  });
}
