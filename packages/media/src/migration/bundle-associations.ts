import {
  MAX_MIGRATION_RECORDS,
  type MigrationRecord,
} from "#shared/migration.ts";
import type { validateCapture } from "#migration/capture/capture-validation.ts";
import { snapshotHash } from "./profile-import.ts";
type Checked = ReturnType<typeof validateCapture>;
type TorrentIdentity = {
  captureHash: string;
  canonicalHash: string;
  wireId: string;
};
function torrentIndex(captures: Checked[]) {
  const index = new Map<string, TorrentIdentity[]>();
  for (const capture of captures.filter(
    (item) => item.snapshot.sourceKind === "qbittorrent",
  )) {
    for (const record of capture.snapshot.records.filter(
      (item) => item.kind === "torrent",
    )) {
      for (const hash of [record.infoHashV1, record.infoHashV2].filter(
        (value) => value !== null,
      )) {
        const matches = index.get(hash) ?? [];
        matches.push({
          captureHash: capture.captureHash,
          canonicalHash: record.infoHash,
          wireId: record.wireId,
        });
        index.set(hash, matches);
      }
    }
  }
  return index;
}
function fileAssociations(
  file: Extract<MigrationRecord, { kind: "file" }>,
  captureHash: string,
  index: Map<string, TorrentIdentity[]>,
) {
  const matches =
    file.downloadHash === null ? [] : (index.get(file.downloadHash) ?? []);
  if (matches.length * file.mediaSourceIds.length > MAX_MIGRATION_RECORDS)
    throw new Error("Bundle association limit exceeded");
  return matches.flatMap((torrent) =>
    file.mediaSourceIds.map((sourceMediaId) => {
      const evidence = {
        managerCaptureHash: captureHash,
        sourceMediaId,
        torrentCaptureHash: torrent.captureHash,
        canonicalHash: torrent.canonicalHash,
        wireId: torrent.wireId,
      };
      return {
        ...evidence,
        evidenceHash: snapshotHash(evidence),
        confidence:
          matches.length === 1 ? ("exact" as const) : ("ambiguous" as const),
      };
    }),
  );
}
export function bundleAssociations(captures: Checked[]) {
  const index = torrentIndex(captures);
  const result = new Map<string, ReturnType<typeof fileAssociations>[number]>();
  for (const capture of captures.filter(
    (item) =>
      item.snapshot.sourceKind === "radarr" ||
      item.snapshot.sourceKind === "sonarr",
  )) {
    for (const file of capture.snapshot.records.filter(
      (item) => item.kind === "file",
    )) {
      for (const association of fileAssociations(
        file,
        capture.captureHash,
        index,
      ))
        result.set(association.evidenceHash, association);
      if (result.size > MAX_MIGRATION_RECORDS)
        throw new Error("Bundle association limit exceeded");
    }
  }
  return [...result.values()];
}
