import type { movieManagementContext } from "#automation/movie-editions/management-context.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { lockMovieCommand } from "#infrastructure/movie-editions/locks.ts";
import { lockRuntimeAuthority } from "#infrastructure/handoff/authority.ts";
import { reserveMovieTransferObservationWriteV1 } from "#infrastructure/movie-editions/transfer-reuse/observation-write.ts";
import { lockMovieSourceParticipants } from "./movie-cohort.ts";
import type { MovieSourceCohort } from "./movie-types.ts";

/** Informational observation only, with a stable complete source membership and pre-reserved SQL parents. */
export async function persistMovieSourceObservation(
  context: ReturnType<typeof movieManagementContext>,
  input: {
    torrent: MovieSourceCohort;
    scope: MovieEditionScope;
    observation: TorrentObservation;
    files: Awaited<ReturnType<MediaAutomationContext["qbittorrent"]["files"]>>;
  },
) {
  const { budget, execution } = context.movieManagement;
  return context.db.$transaction(async (tx) => {
    await lockMovieCommand(tx, input.scope);
    if (!(await lockRuntimeAuthority(tx, input.torrent.ownershipEpoch)))
      return null;
    await lockMovieSourceParticipants(tx, input.torrent);
    const current = await tx.torrent.findUniqueOrThrow({
      where: { id: input.torrent.id },
    });
    budget.consume(1);
    const attempts = await tx.acquisitionAttempt.findMany({
      where: { torrentId: current.id },
      select: { id: true },
      orderBy: { id: "asc" },
      take: budget.take,
    });
    budget.consume(attempts.length);
    const assets = await tx.libraryAsset.findMany({
      where: { torrentId: current.id },
      select: { id: true },
      orderBy: { id: "asc" },
      take: budget.take,
    });
    budget.consume(assets.length);
    if (
      !current.owned ||
      current.ownershipEpoch !== input.torrent.ownershipEpoch ||
      ["removing", "removed"].includes(current.state) ||
      current.infoHash !== input.torrent.infoHash ||
      current.providerId !== input.torrent.providerId ||
      current.qbittorrentId !== input.observation.hash ||
      identityHash(current.seedingPolicy) !==
        identityHash(input.torrent.seedingPolicy) ||
      identityHash(attempts.map((a) => a.id)) !==
        identityHash(input.torrent.attempts.map((a) => a.id)) ||
      identityHash(assets.map((a) => a.id)) !==
        identityHash(input.torrent.assets.map((a) => a.id))
    )
      return null;
    await reserveMovieTransferObservationWriteV1(
      tx,
      { torrentId: current.id, observation: input.observation },
      budget,
    );
    execution.assertActive();
    return tx.torrent.update({
      where: { id: current.id },
      data: {
        observation: { torrent: input.observation, files: input.files },
        observedAt: new Date(),
      },
    });
  });
}

export async function observeMovieSourceForSeeding(
  context: ReturnType<typeof movieManagementContext>,
  input: {
    torrent: MovieSourceCohort;
    scope: MovieEditionScope;
    observation: TorrentObservation;
  },
) {
  const execution = context.movieManagement.execution;
  const files =
    input.observation.progress === 1
      ? await context.qbittorrent.files(
          input.observation.hash,
          execution.signal,
        )
      : [];
  execution.assertActive();
  return files.length > 100
    ? null
    : persistMovieSourceObservation(context, { ...input, files });
}
