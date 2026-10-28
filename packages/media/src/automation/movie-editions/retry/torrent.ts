import type { MediaAutomationContext } from "#automation/context.ts";
import type { readMovieRetrySourceV4 } from "#infrastructure/movie-editions/lifecycle/retry-source.ts";
import { CandidateSourceEvidenceSchema } from "#shared/acquisition/identity.ts";
import { MovieRetryRenewalV1Schema } from "#shared/movie-editions/retry/v1.ts";
import { ownedTorrent } from "#automation/acquisition-management/ownership.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { MediaError } from "#application/errors.ts";

/** Observe an actual prior Media add, never import an external torrent or issue another add. */
export async function movieRetryTorrentV1(
  context: MediaAutomationContext,
  source: Awaited<ReturnType<typeof readMovieRetrySourceV4>>,
) {
  const execution = context.plexBindingExecution();
  const original = CandidateSourceEvidenceSchema.parse(
    source.recorded.release.sourceEvidence,
  );
  execution.assertActive();
  await context.qbittorrent.login(execution.signal);
  execution.assertActive();
  const observed = await context.qbittorrent.observe(
    original.infoHash,
    execution.signal,
  );
  execution.assertActive();
  if (
    observed === null &&
    source.state === "reserved" &&
    source.attempt.torrent === null
  )
    return null;
  const torrent = source.attempt.torrent;
  if (
    observed === null ||
    torrent === null ||
    !torrent.owned ||
    torrent.ownershipEpoch !== source.attempt.recoveryEpoch ||
    torrent.infoHash !== original.infoHash ||
    torrent.qbittorrentId !== observed.hash ||
    torrent.providerId !== source.recorded.release.providerId ||
    !ownedTorrent(context, observed, source.attempt)
  )
    throw new MediaError(
      "movie_retry_torrent_unconfirmed",
      "Retry requires the original Media-created transfer and exact ownership tags",
      409,
    );
  if (!hasApplicationSeedingPolicy(observed))
    throw new MediaError(
      "torrent_policy_drift",
      "Original torrent policy changed",
      409,
    );
  return MovieRetryRenewalV1Schema.shape.torrent.parse({
    id: torrent.id,
    infoHash: torrent.infoHash,
    qbittorrentId: observed.hash,
    providerId: torrent.providerId,
    ownershipEpoch: torrent.ownershipEpoch,
    observationHash: identityHash(observed),
    savePath: observed.save_path,
    contentPath: observed.content_path,
    tags: observed.tags,
    category: observed.category,
    policyHash: identityHash(torrent.seedingPolicy),
  });
}
