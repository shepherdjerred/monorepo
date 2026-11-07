import type { TorrentObservation } from "#integrations/qbittorrent.ts";
import type { MovieTransferReuseGrantV1 } from "#shared/movie-editions/transfer-reuse/v1.ts";
import { hasApplicationSeedingPolicy } from "#integrations/qbittorrent-policy.ts";

export function movieTransferObservationMatches(
  transfer: MovieTransferReuseGrantV1["transfer"],
  observed: Pick<
    TorrentObservation,
    "hash" | "save_path" | "content_path" | "tags" | "category"
  >,
): boolean {
  return (
    observed.hash === transfer.qbittorrentId &&
    observed.save_path === transfer.savePath &&
    observed.content_path === transfer.contentPath &&
    observed.tags === transfer.tags &&
    observed.category === transfer.category
  );
}

export function movieTransferObservationProblem(
  grant: MovieTransferReuseGrantV1 | null,
  observed: TorrentObservation,
) {
  if (grant === null) return null;
  if (!movieTransferObservationMatches(grant.transfer, observed))
    return "torrent_ownership_conflict";
  return hasApplicationSeedingPolicy(observed) ? null : "torrent_policy_drift";
}
