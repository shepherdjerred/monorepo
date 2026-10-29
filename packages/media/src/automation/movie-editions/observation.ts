import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import { ownedTorrent } from "#automation/acquisition-management/ownership.ts";
import { networkMovieAccess } from "#automation/editions/access.ts";
import { requireMovieChoiceAccess } from "#infrastructure/movie-editions/access.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { assertNoPublicationCompensationFence } from "#infrastructure/native-compensation/fence.ts";
import { readMovieAttemptIdentityV4 } from "#infrastructure/movie-editions/lifecycle/attempt-identity.ts";
import { movieAttemptEffectAuthorityV4 } from "#infrastructure/movie-editions/lifecycle/effect-authority.ts";
import {
  MovieAttemptOperationV4Schema,
  type MovieAttemptOperationV4,
} from "#shared/movie-editions/automation-v4.ts";
import type { MediaNetworkActivities } from "#shared/automation.ts";
import { validMovieAttemptV4 } from "./submission.ts";
import { movieManagementContext } from "./management-context.ts";

export async function observeMovieAcquisitionV4(
  initial: MediaAutomationContext,
  raw: MovieAttemptOperationV4,
): ReturnType<MediaNetworkActivities["observeMediaAcquisition"]> {
  const context = movieManagementContext(initial);
  const execution = context.plexBindingExecution();
  execution.assertActive();
  const input = MovieAttemptOperationV4Schema.parse(raw);
  const attempt = await context.db.acquisitionAttempt.findUniqueOrThrow({
    where: { id: input.attemptId },
    include: { torrent: true },
  });
  await readMovieAttemptIdentityV4(context.db, attempt, input.scope);
  if (attempt.state === "imported" || attempt.state === "completed")
    return { status: "ready", reason: "resume_committed_publication" };
  if (!(await validMovieAttemptV4(context, input)))
    return {
      status: attempt.filePlan === null ? "obsolete" : "blocked",
      reason:
        attempt.filePlan === null
          ? "intent_changed"
          : "movie_publication_reconciliation_required",
    };
  if (attempt.torrent === null)
    return { status: "blocked", reason: "torrent_missing" };
  const torrentId = attempt.torrent.id;
  if (
    !attempt.torrent.owned ||
    attempt.torrent.ownershipEpoch !== attempt.recoveryEpoch
  )
    return { status: "blocked", reason: "record_ownership_unconfirmed" };
  await context.qbittorrent.login(execution.signal);
  execution.assertActive();
  const torrent = await context.qbittorrent.observe(
    attempt.torrent.infoHash,
    execution.signal,
  );
  execution.assertActive();
  if (torrent === null) return { status: "blocked", reason: "torrent_missing" };
  if (!ownedTorrent(context, torrent, attempt))
    return { status: "blocked", reason: "torrent_ownership_conflict" };
  const files =
    torrent.progress === 1
      ? await context.qbittorrent.files(torrent.hash, execution.signal)
      : [];
  execution.assertActive();
  if (files.length > 100)
    return { status: "blocked", reason: "torrent_inventory_limit" };
  const access = requireMovieChoiceAccess(
    (await networkMovieAccess(context, [input.scope.mediaId])) ?? {},
  );
  const recorded = await serializable(context.db, async (tx) => {
    await lockMovieCommand(tx, input.scope);
    await assertNoPublicationCompensationFence(tx, {
      mediaIds: [input.scope.mediaId],
    });
    if (!(await lockRuntimeAuthority(tx, attempt.recoveryEpoch))) return false;
    const current = await tx.acquisitionAttempt.findUniqueOrThrow({
      where: { id: attempt.id },
    });
    if (
      current.coordinatorOperationId !== input.operationId ||
      current.torrentId !== attempt.torrentId
    )
      return false;
    const authority = await movieAttemptEffectAuthorityV4(
      tx,
      current,
      input.scope,
      { access, invocation: context.movieManagement },
    );
    if (authority === null) return false;
    execution.assertActive();
    await tx.torrent.update({
      where: { id: torrentId },
      data: {
        observation: { torrent, files },
        observedAt: new Date(),
        state: torrent.progress === 1 ? "seeding" : "downloading",
      },
    });
    authority.freshness.assertActive();
    execution.assertActive();
    return true;
  });
  if (!recorded) return { status: "obsolete", reason: "intent_changed" };
  return {
    status: torrent.progress === 1 ? "ready" : "downloading",
    reason: null,
  };
}
