import { MigrationRecordSchema } from "#shared/migration.ts";
import { normalizeTorrentObservation } from "#migration/capture/torrent-capture.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { LoadedHandoffPlan } from "./plan.ts";
import { protectedEvidence, type HandoffNetworkContext } from "./context.ts";

type TorrentRecord = Extract<
  ReturnType<typeof MigrationRecordSchema.parse>,
  { kind: "torrent" }
>;
export function torrentIdentity(record: TorrentRecord) {
  const {
    progress: _progress,
    ratio: _ratio,
    seededSeconds: _seeded,
    managerAssociations: _associations,
    ...identity
  } = record;
  return identity;
}
export async function observeTorrents(
  context: HandoffNetworkContext,
  input: LoadedHandoffPlan,
  signal: AbortSignal,
) {
  const selected = input.report.entries.filter(
    (entry) =>
      entry.kind === "torrent" &&
      input.scope.request.selected.some(
        (selection) => selection.provenanceKey === entry.provenanceKey,
      ),
  );
  if (selected.length === 0) return [];
  const observed = await context.qbittorrent.listAll(signal);
  const current = observed.map((item) => {
    const record = normalizeTorrentObservation(item);
    if (record.kind !== "torrent")
      throw new Error("Torrent normalizer returned another kind");
    return record;
  });
  const evidence = [];
  for (const entry of selected) {
    const capture = input.manifest.captures.find(
      (item) => item.captureHash === entry.captureHash,
    );
    if (!capture) throw protectedEvidence("handoff_torrent_capture_missing");
    const stored = await context.db.migrationRecord.findUniqueOrThrow({
      where: {
        captureId_provenanceKey: {
          captureId: capture.captureId,
          provenanceKey: entry.provenanceKey,
        },
      },
    });
    const record = MigrationRecordSchema.parse(stored.payload);
    if (record.kind !== "torrent")
      throw new Error("Persisted torrent record kind mismatch");
    const matches = current.filter((item) => item.infoHash === record.infoHash);
    const match = matches[0];
    if (
      !match ||
      matches.length !== 1 ||
      snapshotHash(torrentIdentity(match)) !==
        snapshotHash(torrentIdentity(record))
    )
      throw protectedEvidence("handoff_torrent_changed");
    evidence.push({
      provenanceKey: entry.provenanceKey,
      infoHash: match.infoHash,
      wireId: match.wireId,
      observationHash: snapshotHash(match),
      identityHash: snapshotHash(torrentIdentity(match)),
      cleanup: "protected_legacy_source" as const,
    });
  }
  return evidence;
}
