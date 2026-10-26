import { z } from "zod";
import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import {
  captureMovieChoiceV4,
  assertMovieChoiceV4,
} from "#infrastructure/movie-editions/lifecycle/authority.ts";
import { movieAcquisitionIdentityV4 } from "#infrastructure/movie-editions/lifecycle/identity.ts";
import { assertMovieAcquisitionOperationV4 } from "#infrastructure/movie-editions/lifecycle/operation.ts";
import { assertCurrentMovieAssessment } from "#infrastructure/movie-editions/release-assessment.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  MovieOperationV4Schema,
  type MovieOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import { MovieAcquisitionIdentityV2Schema } from "#shared/movie-editions/acquisition-v2.ts";
import type { MovieReleaseAssessmentRef } from "#shared/movie-editions/release-assessment.ts";
import { chooseUpgrade } from "#domain/quality.ts";
import { currentMovieReleaseV4, requireMovieSponsorV4 } from "./candidates.ts";

/** Reserve one edition under the same canonical/request/runtime locks used by its command. */
export async function reserveMovieCandidateV4(
  context: MediaAutomationContext,
  raw: MovieOperationV4,
  selected: { releaseId: string; assessment: MovieReleaseAssessmentRef },
  epoch: number,
) {
  const input = MovieOperationV4Schema.parse(raw);
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.mediaId])) ?? {},
  );
  if (!(await context.gates.acquisition())) return null;
  return serializable(context.db, async (tx) => {
    const { target } = await lockMovieCommand(tx, input.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, epoch))) return null;
    const operation = await assertMovieAcquisitionOperationV4(
      tx,
      input.operationId,
      input.scope,
      epoch,
    );
    if (
      operation.operation.status === "completed" ||
      operation.operation.status === "failed"
    )
      return null;
    if (
      operation.input.generation !== input.generation ||
      target?.generation !== input.generation ||
      target.automationEpoch !== epoch ||
      !target.monitoring ||
      !target.desiredPresence ||
      target.intentionallyRemovedAt !== null
    )
      return null;
    const removing = await tx.retentionDecision.count({
      where: {
        mediaId: input.mediaId,
        edition: input.scope.edition,
        state: { in: ["warning_pending", "grace_period", "quarantined"] },
      },
    });
    if (removing > 0) return null;
    const existing = await tx.acquisitionReservation.findUnique({
      where: {
        mediaId_edition: {
          mediaId: input.mediaId,
          edition: input.scope.edition,
        },
      },
      include: { attempt: true },
    });
    if (existing !== null) {
      if (
        existing.attempt.operationId !== input.operationId ||
        existing.attempt.releaseId !== selected.releaseId
      )
        return null;
      const identity = MovieAcquisitionIdentityV2Schema.parse(
        existing.attempt.identityEvidence,
      );
      if (
        identityHash(identity.assessment) !== identityHash(selected.assessment)
      )
        return null;
      await assertCurrentMovieAssessment(
        tx,
        identity.assessment,
        input.scope,
        selected.releaseId,
      );
      const guard = await assertMovieChoiceV4(tx, {
        attemptId: existing.attemptId,
        scope: input.scope,
        epoch,
        access,
      });
      guard.assertActive();
      return existing.attemptId;
    }
    const assessed = await assertCurrentMovieAssessment(
      tx,
      selected.assessment,
      input.scope,
      selected.releaseId,
    );
    const candidate = {
      id: selected.releaseId,
      providerId: assessed.release.providerId,
      title: assessed.release.title,
      ...assessed.value.attributes,
    };
    const profile = {
      id: assessed.current.profile.id,
      version: assessed.current.profile.version,
      ...assessed.current.rules,
    };
    if (
      !chooseUpgrade({
        candidate,
        current: await currentMovieReleaseV4(tx, input.scope),
        profile,
        mediaIds: [input.mediaId],
      }).upgrade
    )
      return null;
    const sponsor = await requireMovieSponsorV4(tx, input.scope, access);
    const birth = await captureMovieChoiceV4(tx, {
      scope: input.scope,
      sponsorRequestId: sponsor.request.id,
      epoch,
      access,
    });
    const identity = await movieAcquisitionIdentityV4(tx, {
      operationId: input.operationId,
      sponsorRequestId: sponsor.request.id,
      releaseId: selected.releaseId,
      epoch,
      scope: input.scope,
      assessment: selected.assessment,
      access,
    });
    const attempt = await tx.acquisitionAttempt.create({
      data: {
        edition: input.scope.edition,
        releaseId: selected.releaseId,
        sponsorRequestId: sponsor.request.id,
        mediaIds: [input.mediaId],
        generations: { [input.mediaId]: target.generation },
        operationId: input.operationId,
        coordinatorOperationId: input.operationId,
        recoveryEpoch: epoch,
        state: "reserved",
        movieEditionChoiceId: birth.proof.choiceId,
        movieEditionChoiceRevision: birth.proof.choiceRevision,
        movieEditionAuthority: birth.proof,
        identityEvidence: z.record(z.string(), z.json()).parse(identity),
        failure: { profileId: profile.id, profileVersion: profile.version },
        reservations: {
          create: {
            mediaId: input.mediaId,
            generation: target.generation,
          },
        },
      },
    });
    await tx.operation.update({
      where: { id: input.operationId },
      data: { status: "running" },
    });
    await tx.mediaIntent.update({
      where: {
        mediaId_edition: {
          mediaId: input.mediaId,
          edition: input.scope.edition,
        },
      },
      data: { availability: "searching" },
    });
    await tx.mediaItem.update({
      where: { id: input.mediaId },
      data: {
        version: { increment: 1 },
        ...(input.scope.edition === "default"
          ? { availability: "searching" }
          : {}),
      },
    });
    sponsor.freshness.assertActive();
    birth.freshness.assertActive();
    return attempt.id;
  });
}
