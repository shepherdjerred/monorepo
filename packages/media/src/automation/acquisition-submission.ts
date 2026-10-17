import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { z } from "zod";
import type { MediaAutomationContext } from "./context.ts";
import path from "node:path";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { evaluateRelease } from "#domain/quality.ts";
import { requireActiveRuntime } from "./runtime.ts";
import { serializable, queueOperation } from "./store.ts";
import { IntegrationError } from "#integrations/http.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import { StoredCandidateSchema } from "./providers.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { loadProfile } from "./acquisition-candidates.ts";
import { authorizedSubmission } from "./reconciliation/submission.ts";
import { lockAcquisitionMedia } from "#infrastructure/acquisition-identity/locks.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { assertLegacySubmissionSponsor } from "#infrastructure/acquisition-identity/sponsor.ts";
import { effectiveCandidate } from "#domain/acquisition-identity/effective.ts";
import { lockEffectiveRequests } from "#infrastructure/request-claims.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { mirrorDefaultAvailability } from "#infrastructure/editions/availability.ts";
const GenerationsSchema = z.record(z.string(), z.number().int().nonnegative());
const ProfileSnapshotSchema = z.object({
  profileId: z.string(),
  profileVersion: z.number().int(),
});

export async function validAttempt(
  context: MediaAutomationContext,
  attemptId: string,
): Promise<boolean> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { release: true },
  });
  const runtime = await requireActiveRuntime(context.db);
  if (attempt.edition !== "default") return false;
  if (!runtime.active || runtime.epoch !== attempt.recoveryEpoch) return false;
  const generations = GenerationsSchema.parse(attempt.generations);
  ProfileSnapshotSchema.parse(attempt.failure);
  const intents = await context.db.mediaIntent.findMany({
    where: { edition: "default", mediaId: { in: attempt.mediaIds } },
    include: { profile: true },
  });
  const claims = await context.db.mediaRequest.findMany({
    where: { mediaId: { in: attempt.mediaIds }, ...effectiveRequestWhere },
    select: { mediaId: true },
    distinct: ["mediaId"],
  });
  if (
    claims.length !== attempt.mediaIds.length ||
    intents.length !== attempt.mediaIds.length ||
    intents.some(
      (intent) =>
        !intent.desiredPresence ||
        intent.automationEpoch !== attempt.recoveryEpoch ||
        !intent.monitoring ||
        intent.profile === null,
    )
  ) {
    if (attempt.filePlan === null)
      await serializable(context.db, async (tx) => {
        await tx.acquisitionAttempt.update({
          where: { id: attempt.id },
          data: { state: "cancelled" },
        });
        await tx.acquisitionReservation.deleteMany({
          where: { attemptId: attempt.id },
        });
      });
    return false;
  }
  const identity = await serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, attempt.mediaIds);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: attempt.mediaIds,
    });
    await lockEffectiveRequests(tx, attempt.mediaIds);
    if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return null;
    await assertLegacySubmissionSponsor(tx, attempt, context.serverMachineId);
    return await assertAttemptIdentity(tx, attempt, context.serverMachineId);
  });
  const rawRelease = {
    id: attempt.release.id,
    providerId: attempt.release.providerId,
    title: attempt.release.title,
    ...PublicReleaseAttributesSchema.parse(attempt.release.attributes),
  };
  const release =
    identity === null ? rawRelease : effectiveCandidate(rawRelease, identity);
  for (const intent of intents) {
    const profile = await loadProfile(context.db, intent.mediaId);
    if (
      profile === null ||
      !evaluateRelease(release, profile, [intent.mediaId]).accepted
    )
      return false;
    if (intent.generation === generations[intent.mediaId]) continue;
    await serializable(context.db, async (tx) => {
      await lockAcquisitionMedia(tx, attempt.mediaIds);
      await assertNoPublicationCompensationFence(tx, {
        mediaIds: attempt.mediaIds,
      });
      await lockEffectiveRequests(tx, attempt.mediaIds);
      if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch)))
        throw new IntegrationError("media", "conflict");
      await assertAttemptIdentity(tx, attempt, context.serverMachineId);
      await tx.mediaItem.update({
        where: { id: intent.mediaId },
        data: { version: { increment: 1 } },
      });
      const current = await tx.mediaIntent.findUniqueOrThrow({
        where: targetWhere(defaultScope(intent.mediaId)),
      });
      if (current.generation !== intent.generation)
        throw new IntegrationError("media", "conflict");
      generations[intent.mediaId] = current.generation;
      await tx.acquisitionAttempt.update({
        where: { id: attempt.id },
        data: {
          generations,
          failure: { profileId: profile.id, profileVersion: profile.version },
        },
      });
      await tx.acquisitionReservation.update({
        where: targetWhere(defaultScope(intent.mediaId)),
        data: { generation: current.generation },
      });
    });
  }
  return true;
}

export async function submit(
  context: MediaAutomationContext,
  input: { operationId: string; attemptId: string },
): ReturnType<MediaNetworkActivities["submitMediaTorrent"]> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { release: true, torrent: true },
  });
  const recovering =
    attempt.state === "submitting" || attempt.state === "submission_unknown";
  const prerequisite = await submissionPrerequisite(
    context,
    attempt,
    recovering,
  );
  if (prerequisite !== null)
    return {
      status:
        prerequisite === "intent_changed" ||
        (!recovering && prerequisite === "recovery_epoch_changed")
          ? "obsolete"
          : "blocked",
      reason: prerequisite,
    };
  if (attempt.state === "imported")
    return { status: "submitted", reason: "resume_committed_publication" };
  if (attempt.release.encryptedSource === null)
    return { status: "blocked", reason: "release_source_missing" };
  const candidate = StoredCandidateSchema.parse(
    JSON.parse(
      context.cipher.decrypt(
        attempt.release.encryptedSource,
        `release:${attempt.release.providerId}:${attempt.release.providerReleaseId}`,
      ),
    ),
  );
  await context.qbittorrent.login();
  const existing = await context.qbittorrent.observe(candidate.infoHash);
  if (existing === null) {
    if (recovering)
      return { status: "blocked", reason: "submission_outcome_unknown" };
    const result = await prepareAndSubmit(context, attempt, candidate);
    if (result !== null) return result;
  } else if (!ownedTorrent(context, existing, attempt))
    return { status: "blocked", reason: "torrent_ownership_conflict" };
  const observed = await context.qbittorrent.observe(candidate.infoHash);
  if (observed === null)
    return { status: "waiting", reason: "submission_visibility_pending" };
  return ownedTorrent(context, observed, attempt)
    ? registerObservedSubmission(context, attempt, candidate, observed)
    : { status: "blocked", reason: "torrent_ownership_conflict" };
}

async function submissionPrerequisite(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  recovering: boolean,
): Promise<string | null> {
  if (attempt.edition !== "default") return "edition_not_available";
  const runtime = await requireActiveRuntime(context.db);
  if (runtime.epoch !== attempt.recoveryEpoch) return "recovery_epoch_changed";
  if (!runtime.active) return "runtime_observe";
  if (!recovering && !(await validAttempt(context, attempt.id)))
    return "intent_changed";
  return !recovering && !(await context.gates.acquisition())
    ? "acquisition_disabled"
    : null;
}

async function prepareAndSubmit(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  candidate: ProviderCandidate,
): Promise<{ status: "waiting" | "blocked"; reason: string } | null> {
  const preparation = await prepareTorrent(context, candidate);
  if (preparation.reason !== null)
    return {
      status: preparation.wait ? "waiting" : "blocked",
      reason: preparation.reason,
    };
  const reason = await submitNew(
    context,
    attempt,
    candidate,
    preparation.bytes,
  );
  return reason === null ? null : { status: "blocked", reason };
}

async function registerObservedSubmission(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  candidate: ProviderCandidate,
  observed: TorrentObservation,
): ReturnType<MediaNetworkActivities["submitMediaTorrent"]> {
  const policySafe = hasApplicationSeedingPolicy(observed);
  const provider = await context.db.mediaProvider.findUniqueOrThrow({
    where: { id: candidate.providerId },
  });
  const registered = await serializable(context.db, async (tx) => {
    await lockAcquisitionMedia(tx, attempt.mediaIds);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: attempt.mediaIds,
    });
    await lockEffectiveRequests(tx, attempt.mediaIds);
    if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return false;
    await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
    const currentRuntime = await tx.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    if (
      currentRuntime.mode !== "active" ||
      !currentRuntime.ownershipConfirmed ||
      currentRuntime.recoveryEpoch !== attempt.recoveryEpoch
    )
      return false;
    const activeClaims = await tx.mediaRequest.findMany({
      where: { mediaId: { in: attempt.mediaIds }, ...effectiveRequestWhere },
      distinct: ["mediaId"],
      select: { mediaId: true },
    });
    const currentIntents = await tx.mediaIntent.findMany({
      where: { edition: "default", mediaId: { in: attempt.mediaIds } },
    });
    const canProject =
      activeClaims.length === attempt.mediaIds.length &&
      currentIntents.every(
        (intent) =>
          intent.monitoring &&
          intent.desiredPresence &&
          intent.intentionallyRemovedAt === null,
      );
    const torrent = await tx.torrent.upsert({
      where: { infoHash: candidate.infoHash },
      create: {
        infoHash: candidate.infoHash,
        qbittorrentId: observed.hash,
        providerId: candidate.providerId,
        owned: true,
        ownershipEpoch: attempt.recoveryEpoch,
        seedingPolicy: z
          .record(z.string(), z.json())
          .parse(provider.seedingPolicy),
        state: policySafe ? "downloading" : "policy_drift",
      },
      update: { qbittorrentId: observed.hash },
    });
    if (!torrent.owned || torrent.ownershipEpoch !== attempt.recoveryEpoch)
      throw new Error("Cannot adopt unowned torrent");
    await tx.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: {
        torrentId: torrent.id,
        state: canProject ? "downloading" : "cancelled",
      },
    });
    await queueOperation(tx, {
      key: `seed:${torrent.id}`,
      kind: "maintain_torrent",
      targetId: torrent.id,
      payload: { torrentId: torrent.id },
    });
    if (canProject) {
      await tx.mediaItem.updateMany({
        where: { id: { in: attempt.mediaIds } },
        data: { availability: "downloading" },
      });
      await mirrorDefaultAvailability(tx, attempt.mediaIds, "downloading");
    }
    return true;
  });
  if (!registered)
    return { status: "blocked", reason: "recovery_epoch_changed" };
  return policySafe
    ? { status: "submitted", reason: null }
    : { status: "blocked", reason: "torrent_policy_drift" };
}

/** Observe a journaled uncertain add even after its requesting claim was cancelled. */
export async function reconcileUnconfirmedSubmission(
  context: MediaAutomationContext,
  attemptId: string,
): Promise<void> {
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: attemptId },
  });
  if (
    attempt.torrentId !== null ||
    !["submitting", "submission_unknown"].includes(attempt.state)
  )
    return;
  const result = await submit(context, {
    operationId: attempt.operationId,
    attemptId,
  });
  if (result.status === "blocked")
    await context.db.operation.update({
      where: { id: attempt.coordinatorOperationId ?? attempt.operationId },
      data: { status: "reconciling" },
    });
}

function ownedTorrent(
  context: MediaAutomationContext,
  observed: Parameters<
    MediaAutomationContext["qbittorrent"]["validateOwnership"]
  >[0],
  attempt: { id: string; operationId: string },
): boolean {
  try {
    context.qbittorrent.validateOwnership(observed, {
      operationId: attempt.operationId,
      attemptId: attempt.id,
      savePath: path.join(context.downloadRoot, "media", attempt.id),
    });
    return true;
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    return false;
  }
}

async function prepareTorrent(
  context: MediaAutomationContext,
  candidate: ProviderCandidate,
): Promise<{
  bytes: Uint8Array<ArrayBuffer> | null;
  reason: string | null;
  wait: boolean;
}> {
  if (candidate.download.kind === "magnet")
    return { bytes: null, reason: null, wait: false };
  try {
    const bytes = await context.providers.withProvider(
      candidate.providerId,
      async (client) => {
        if (client.download === undefined)
          throw new IntegrationError(candidate.providerId, "invalid-response");
        return client.download(candidate);
      },
    );
    return { bytes, reason: null, wait: false };
  } catch (error) {
    if (!(error instanceof IntegrationError)) throw error;
    return {
      bytes: null,
      reason: error.kind,
      wait: error.kind === "rate-limited" || error.kind === "unavailable",
    };
  }
}

async function submitNew(
  context: MediaAutomationContext,
  attempt: AcquisitionAttempt,
  candidate: ProviderCandidate,
  bytes: Uint8Array<ArrayBuffer> | null,
): Promise<string | null> {
  if (attempt.state === "submitting" || attempt.state === "submission_unknown")
    return "submission_outcome_unknown";
  const claimed = await context.db.acquisitionAttempt.updateMany({
    where: { id: attempt.id, state: "reserved" },
    data: { state: "submitting" },
  });
  if (claimed.count !== 1) return "submission_outcome_unknown";
  try {
    const savePath = path.join(context.downloadRoot, "media", attempt.id);
    const authorized = await authorizedSubmission(
      context,
      attempt,
      async (signal) => {
        if (candidate.download.kind === "magnet")
          await context.qbittorrent.submit(
            {
              operationId: attempt.operationId,
              attemptId: attempt.id,
              hash: candidate.infoHash,
              magnet: candidate.download.value,
              savePath,
            },
            signal,
          );
        else {
          if (bytes === null) throw new Error("Prepared torrent bytes missing");
          await context.qbittorrent.submitTorrent(
            {
              operationId: attempt.operationId,
              attemptId: attempt.id,
              hash: candidate.infoHash,
              bytes,
              savePath,
            },
            signal,
          );
        }
      },
    );
    if (!authorized) {
      await context.db.acquisitionAttempt.updateMany({
        where: { id: attempt.id, state: "submitting" },
        data: { state: "reserved" },
      });
      return "submission_authority_changed";
    }
    return null;
  } catch (error) {
    await context.db.acquisitionAttempt.update({
      where: { id: attempt.id },
      data: { state: "submission_unknown" },
    });
    if (!(error instanceof IntegrationError)) throw error;
    return error.kind;
  }
}
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
