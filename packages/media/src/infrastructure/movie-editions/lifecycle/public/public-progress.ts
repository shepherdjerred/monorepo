import type { Prisma } from "#generated/prisma/client.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { MovieTargetProgressV4Schema } from "#shared/movie-editions/lifecycle/public-v4.ts";
import { torrentVisibility } from "#infrastructure/visibility/torrent.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

const HISTORY_LIMIT = 10;

/** Recorded transfer progress is independent of playback and never supplies effect authority. */
export async function readMovieTargetProgressV4(
  tx: Prisma.TransactionClient,
  input: {
    scope: MovieEditionScope;
    epoch: number;
    owner: boolean;
    ownDemand: boolean;
  },
  budget: PublicationAuthorityReadBudget,
) {
  if (!input.owner && !input.ownDemand) return null;
  const selected: Prisma.AcquisitionAttemptWhereInput = {
    edition: input.scope.edition,
    mediaIds: { equals: [input.scope.mediaId] },
  };
  const remaining = Math.max(0, budget.take - 1);
  const attemptTake = Math.min(
    HISTORY_LIMIT + 1,
    remaining < 4 ? remaining : remaining - 4,
  );
  const attempts =
    attemptTake === 0
      ? []
      : await tx.acquisitionAttempt.findMany({
          where: selected,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: attemptTake,
          select: {
            id: true,
            state: true,
            torrentId: true,
            createdAt: true,
            recoveryEpoch: true,
          },
        });
  budget.consume(attempts.length);
  // Each returned torrent has at most two included dependency witnesses and one extra unknown-add
  // witness. Presentation truncates before reading; it never rejects or renews required authority.
  const torrentTake = Math.min(
    HISTORY_LIMIT + 1,
    Math.floor(Math.max(0, budget.take - 1) / 4),
  );
  const torrents =
    torrentTake === 0
      ? []
      : await tx.torrent.findMany({
          where: {
            owned: true,
            OR: [
              { attempts: { some: selected } },
              {
                assets: {
                  some: {
                    owned: true,
                    edition: input.scope.edition,
                    editionRootId: input.scope.rootMediaId,
                    coverage: {
                      some: {
                        mediaId: input.scope.mediaId,
                        edition: input.scope.edition,
                        current: true,
                      },
                    },
                  },
                },
              },
            ],
          },
          include: {
            attempts: {
              where: { state: { notIn: ["completed", "cancelled"] } },
              select: { id: true, state: true },
              orderBy: { id: "asc" },
              take: 1,
            },
            assets: {
              where: {
                state: {
                  notIn: ["published", "superseded", "quarantined", "purged"],
                },
              },
              select: { id: true, state: true },
              orderBy: { id: "asc" },
              take: 1,
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: torrentTake,
        });
  budget.consume(
    torrents.reduce(
      (count, torrent) =>
        count + 1 + torrent.attempts.length + torrent.assets.length,
      0,
    ),
  );
  const visible = [];
  const now = new Date();
  for (const torrent of torrents.slice(0, HISTORY_LIMIT)) {
    // Separate existential witnesses keep both unknown-add and source-in-use diagnostics complete,
    // even when a Media-created transfer has many immutable retry/reuse descendants.
    const unknown = torrent.attempts.some(
      (attempt) => attempt.state === "submission_unknown",
    )
      ? null
      : await tx.acquisitionAttempt.findFirst({
          where: { torrentId: torrent.id, state: "submission_unknown" },
          select: { id: true, state: true },
          orderBy: { id: "asc" },
        });
    if (unknown !== null) budget.consume(1);
    visible.push(
      torrentVisibility(
        {
          ...torrent,
          attempts:
            unknown === null
              ? torrent.attempts
              : [...torrent.attempts, unknown],
        },
        { epoch: input.epoch, owner: input.owner, now },
      ),
    );
  }
  return MovieTargetProgressV4Schema.parse({
    attempts: attempts.slice(0, HISTORY_LIMIT).map((attempt) => ({
      id: attempt.id,
      state: attempt.state,
      torrentId: attempt.torrentId,
      createdAt: attempt.createdAt.toISOString(),
      currentEpoch: attempt.recoveryEpoch === input.epoch,
    })),
    torrents: visible,
    historyTruncated:
      presentationTruncated(attempts.length, attemptTake) ||
      presentationTruncated(torrents.length, torrentTake),
  });
}

function presentationTruncated(count: number, take: number) {
  return (
    take === 0 ||
    count > HISTORY_LIMIT ||
    (take <= HISTORY_LIMIT && count === take)
  );
}
