import { z } from "zod";
import type { NativeRecoveryScope } from "#shared/native-recovery.ts";
import type { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { NativeTorrentObservationSchema } from "#shared/native-torrent.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { torrentIdentity } from "#migration/handoff-network/torrents.ts";
import { snapshotHash } from "#migration/profile-import.ts";

const Attempt = z.object({
  id: z.uuid(),
  state: z.enum(["completed", "cancelled"]),
  recoveryEpoch: z.int().nonnegative(),
});
function capturedTorrent(torrent: NativeRecoveryScope["torrents"][number]) {
  const normalized = NativeTorrentObservationSchema.parse(
    torrent.observation,
  ).identity;
  if (
    normalized.infoHash !== torrent.infoHash ||
    normalized.wireId !== torrent.qbittorrentId
  )
    throw new Error("Native torrent recorded identity is inconsistent");
  return normalized;
}
export async function observeNativeTorrents(input: {
  torrents: NativeRecoveryScope["torrents"];
  qbittorrent: Pick<QbittorrentClient, "listAll">;
  signal: AbortSignal;
}) {
  if (input.torrents.length === 0) return [];
  const items = await input.qbittorrent.listAll(input.signal);
  const observed = items.map((item) => normalizeTorrentObservation(item));
  return input.torrents.map((torrent) => observeTorrent(torrent, observed));
}
function observeTorrent(
  torrent: NativeRecoveryScope["torrents"][number],
  observed: ReturnType<typeof normalizeTorrentObservation>[],
) {
  const captured = capturedTorrent(torrent);
  const matches = observed.filter(
    (item) =>
      item.kind === "torrent" &&
      (item.infoHash === captured.infoHash ||
        item.wireId === captured.wireId ||
        (captured.infoHashV2 !== null &&
          item.infoHashV2 === captured.infoHashV2)),
  );
  const attempts = z.array(Attempt).min(1).max(100).parse(torrent.attempts);
  if (
    !torrent.owned ||
    torrent.ownershipEpoch < 0 ||
    attempts.some((attempt) => attempt.recoveryEpoch !== torrent.ownershipEpoch)
  )
    throw new Error("Native torrent source ownership is unproven");
  if (torrent.state === "removed") {
    if (matches.length > 0)
      throw new Error("Native terminal torrent unexpectedly remains present");
  } else {
    if (torrent.state !== "seeding")
      throw new Error("Native torrent removal outcome is unknown");
    const match = matches[0];
    if (
      matches.length !== 1 ||
      match?.kind !== "torrent" ||
      snapshotHash(torrentIdentity(match)) !== snapshotHash(captured)
    )
      throw new Error("Native torrent source identity or policy changed");
  }
  return {
    torrentId: torrent.id,
    infoHash: torrent.infoHash,
    wireId: torrent.qbittorrentId,
    identityHash: snapshotHash({
      record: captured,
      policy: torrent.seedingPolicy,
      attempts,
      state: torrent.state,
      ownershipEpoch: torrent.ownershipEpoch,
    }),
    sourceState:
      torrent.state === "removed" ? ("removed" as const) : ("present" as const),
  };
}
