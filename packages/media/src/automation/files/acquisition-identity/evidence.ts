import nodePath from "node:path";
import { z } from "zod";
import type {
  AcquisitionIdentitySnapshot,
  FileIdentityEvidence,
} from "#shared/acquisition/identity.ts";
import type { MovieAcquisitionIdentityV2 } from "#shared/movie-editions/acquisition-v2.ts";
import { parseEpisodeCoordinates } from "#domain/acquisition-identity/parser.ts";
import { resolveEpisodeCoordinates } from "#domain/acquisition-identity/coordinates.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError, type FilePlanEntry } from "#automation/files/types.ts";

export const IdentityTorrentFileSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  name: z.string(),
  size: z.number().int().positive(),
  progress: z.number(),
});
export type IdentityTorrentFile = z.infer<typeof IdentityTorrentFileSchema>;

export function fileIdentityEvidence(
  identity: AcquisitionIdentitySnapshot | MovieAcquisitionIdentityV2,
  file: IdentityTorrentFile,
): FileIdentityEvidence {
  if (file.index === undefined)
    throw new FileGuardError("torrent_file_identity_missing");
  const canonical = identity.canonical;
  const parsed = parseEpisodeCoordinates(nodePath.basename(file.name));
  let coverage: string[];
  if (canonical.kind === "movie") {
    if (parsed.invalid || parsed.forms.some((form) => form.kind !== "unknown"))
      throw new FileGuardError("movie_file_episode_coordinates");
    coverage = [canonical.mediaId];
  } else {
    const result = resolveEpisodeCoordinates(parsed, canonical.coordinates);
    if (result.status === "protected") throw new FileGuardError(result.reason);
    coverage = result.mediaIds;
  }
  if (coverage.some((id) => !identity.coverage.includes(id)))
    throw new FileGuardError("file_coverage_unreserved");
  return {
    schemaVersion: 1,
    attemptIdentityHash: identityHash(identity),
    numberingDigest:
      canonical.kind === "series" ? canonical.coordinates.digest : null,
    sourceFile: {
      torrentFileIndex: file.index,
      relativePath: file.name,
      sizeBytes: String(file.size),
    },
    parsedCoordinates: canonical.kind === "movie" ? { kind: "movie" } : parsed,
    coverage,
  };
}

export function assertFileIdentity(
  identity: AcquisitionIdentitySnapshot | MovieAcquisitionIdentityV2,
  entry: FilePlanEntry,
  files: IdentityTorrentFile[],
): void {
  const evidence = entry.identityEvidence;
  if (evidence === undefined) throw new FileGuardError("file_identity_missing");
  const matches = files.filter(
    (file) => file.index === evidence.sourceFile.torrentFileIndex,
  );
  const file = matches[0];
  if (file?.progress !== 1 || matches.length !== 1)
    throw new FileGuardError("torrent_file_identity_changed");
  const current = fileIdentityEvidence(identity, file);
  if (
    identityHash(current) !== identityHash(evidence) ||
    String(file.size) !== entry.sizeBytes ||
    identityHash([...current.coverage].sort()) !==
      identityHash([...entry.mediaIds].sort())
  )
    throw new FileGuardError("file_identity_changed");
}
