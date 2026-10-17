import { defaultScope } from "#shared/editions/scope.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import type { QualityProfile } from "#shared/contract.ts";
import { MediaError } from "#application/errors.ts";
import { z } from "zod";
import type { MediaAutomationContext } from "./context.ts";
import { PublicReleaseAttributesSchema } from "#shared/api.ts";
import type {
  MediaNetworkActivities,
  MediaOperation,
} from "#shared/automation.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { requireActiveRuntime } from "./runtime.ts";
import {
  loadProfile,
  currentRelease,
  searchCandidates,
} from "./acquisition-candidates.ts";
import {
  reserveCandidate,
  adoptReservation,
} from "./acquisition-reservation.ts";
import { validAttempt, submit } from "./acquisition-submission.ts";
type AcquisitionActivities = Pick<
  MediaNetworkActivities,
  "reconcileMediaIntent" | "submitMediaTorrent" | "observeMediaAcquisition"
>;
async function reconcile(
  context: MediaAutomationContext,
  input: MediaOperation,
): ReturnType<AcquisitionActivities["reconcileMediaIntent"]> {
  const intent = await context.db.mediaIntent.findUniqueOrThrow({
    where: targetWhere(defaultScope(input.mediaId)),
    include: { media: true },
  });
  if (
    intent.generation !== input.generation ||
    !intent.desiredPresence ||
    !intent.monitoring ||
    intent.intentionallyRemovedAt !== null
  )
    return { status: "obsolete", attemptId: null, reason: "intent_changed" };
  const removal = await context.db.retentionDecision.findFirst({
    where: {
      edition: "default",
      mediaId: input.mediaId,
      state: { in: ["warning_pending", "grace_period", "quarantined"] },
    },
  });
  if (removal !== null)
    return {
      status: "waiting",
      attemptId: null,
      reason: "retention_in_progress",
    };
  if (intent.media.kind === "series" || intent.media.kind === "season")
    return {
      status: "waiting",
      attemptId: null,
      reason: "episodes_reconcile_independently",
    };
  if (
    intent.media.airDate !== null &&
    intent.media.airDate.getTime() > Date.now()
  )
    return { status: "waiting", attemptId: null, reason: "not_yet_aired" };
  const runtime = await requireActiveRuntime(context.db);
  if (!runtime.active || !(await context.gates.acquisition()))
    return {
      status: "blocked",
      attemptId: null,
      reason: "acquisition_disabled",
    };
  if (intent.automationEpoch !== runtime.epoch)
    return {
      status: "blocked",
      attemptId: null,
      reason: "intent_ownership_unconfirmed",
    };
  const profile = await loadProfile(context.db, input.mediaId);
  if (profile === null)
    return {
      status: "blocked",
      attemptId: null,
      reason: "quality_profile_required",
    };
  const adopted = await adoptReservation(context, input, profile);
  if (adopted !== null) return adopted;
  const operation = await context.db.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const selection = z
    .object({
      releaseId: z.string().optional(),
      identityDecision: z.unknown().optional(),
    })
    .parse(operation.payload);
  const selected = selection.releaseId;
  const candidates =
    selected === undefined
      ? await searchCandidates(context, input.mediaId, profile)
      : [selected];
  const releaseId = candidates[0];
  if (releaseId === undefined)
    return {
      status:
        intent.media.availability === "available" ? "available" : "waiting",
      attemptId: null,
      reason: "no_acceptable_release",
    };
  const blocker = await selectionBlocker(context, {
    releaseId,
    profile,
    mediaId: input.mediaId,
    reviewed: selection.identityDecision !== undefined,
  });
  if (blocker !== null)
    return { status: "blocked", attemptId: null, reason: blocker };
  const attemptId = await reserveCandidate(context, input, {
    releaseId,
    profile,
    epoch: runtime.epoch,
  });
  return {
    status: attemptId === null ? "waiting" : "acquire",
    attemptId,
    reason: null,
  };
}

export function createAcquisitionActivities(
  context: MediaAutomationContext,
): AcquisitionActivities {
  return {
    async reconcileMediaIntent(input) {
      try {
        return await reconcile(context, input);
      } catch (error) {
        if (error instanceof MediaError)
          return { status: "blocked", attemptId: null, reason: error.code };
        throw error;
      }
    },
    async submitMediaTorrent(input) {
      try {
        return await submit(context, input);
      } catch (error) {
        if (error instanceof MediaError)
          return { status: "blocked", reason: error.code };
        throw error;
      }
    },
    async observeMediaAcquisition(input) {
      const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
        where: { id: input.attemptId },
        include: { torrent: true },
      });
      if (!(await validAttempt(context, attempt.id)))
        return { status: "obsolete", reason: "intent_changed" };
      if (attempt.state === "imported")
        return { status: "ready", reason: "resume_committed_publication" };
      if (attempt.torrent === null)
        return { status: "blocked", reason: "torrent_missing" };
      await context.qbittorrent.login();
      const torrent = await context.qbittorrent.observe(
        attempt.torrent.infoHash,
      );
      if (torrent === null)
        return { status: "blocked", reason: "torrent_missing" };
      const files =
        torrent.progress === 1
          ? await context.qbittorrent.files(torrent.hash)
          : [];
      await context.db.torrent.update({
        where: { id: attempt.torrent.id },
        data: {
          observation: { torrent, files },
          observedAt: new Date(),
          state: torrent.progress === 1 ? "seeding" : "downloading",
        },
      });
      return {
        status: torrent.progress === 1 ? "ready" : "downloading",
        reason: null,
      };
    },
  };
}

async function selectionBlocker(
  context: MediaAutomationContext,
  input: {
    releaseId: string;
    profile: QualityProfile;
    mediaId: string;
    reviewed: boolean;
  },
) {
  if (input.reviewed) return null;
  const release = await context.db.releaseCandidate.findUniqueOrThrow({
    where: { id: input.releaseId },
  });
  const evaluated = chooseUpgrade({
    candidate: {
      id: release.id,
      providerId: release.providerId,
      title: release.title,
      ...PublicReleaseAttributesSchema.parse(release.attributes),
    },
    current: await currentRelease(context, input.mediaId),
    profile: input.profile,
    mediaIds: [input.mediaId],
  });
  return evaluated.upgrade ? null : evaluated.reason;
}
