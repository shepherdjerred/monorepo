import nodePath from "node:path";
import { z } from "zod";
import type { FileIdentityEvidence } from "#shared/acquisition/identity.ts";
import type { DefaultAcquisitionIdentity } from "#shared/acquisition/library-management.ts";
import type { MovieAcquisitionIdentity } from "#shared/movie-editions/management/contracts.ts";
import { parseEpisodeCoordinates } from "#domain/acquisition-identity/parser.ts";
import { resolveEpisodeCoordinates } from "#domain/acquisition-identity/coordinates.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { FileGuardError, type FilePlanEntry } from "#automation/files/types.ts";
import { resolveTvMemberCoordinates } from "#domain/acquisition-identity/tv-member.ts";
import {
  TvFileIdentityEvidenceV2Schema,
  type DefaultFileIdentityEvidence,
} from "#shared/acquisition/tv-file-evidence-v2.ts";

export const IdentityTorrentFileSchema = z.object({
  index: z.number().int().nonnegative().optional(),
  name: z.string(),
  size: z.number().int().positive(),
  progress: z.number(),
});
export type IdentityTorrentFile = z.infer<typeof IdentityTorrentFileSchema>;

export function fileIdentityEvidence(
  identity: DefaultAcquisitionIdentity | MovieAcquisitionIdentity,
  file: IdentityTorrentFile,
): DefaultFileIdentityEvidence {
  const canonical = identity.canonical;
  if (canonical.kind === "movie")
    return legacyFileIdentityEvidence(identity, file);
  if (file.index === undefined)
    throw new FileGuardError("torrent_file_identity_missing");
  const resolved = resolveTvMemberCoordinates(file.name, canonical.coordinates);
  if (resolved.status === "protected")
    throw new FileGuardError(resolved.reason);
  if (resolved.directory === null)
    return legacyFileIdentityEvidence(identity, file);
  if (resolved.mediaIds.some((id) => !identity.coverage.includes(id)))
    throw new FileGuardError("file_coverage_unreserved");
  return TvFileIdentityEvidenceV2Schema.parse({
    schemaVersion: 2,
    kind: "tv_season_directory",
    attemptIdentityHash: identityHash(identity),
    numberingDigest: canonical.coordinates.digest,
    sourceFile: {
      torrentFileIndex: file.index,
      relativePath: file.name,
      sizeBytes: String(file.size),
    },
    parsedCoordinates: resolved.parsed,
    directory: resolved.directory,
    coverage: resolved.mediaIds,
  });
}

/** Recorded v1 plans retain the original basename-only interpretation. */
function legacyFileIdentityEvidence(
  identity: DefaultAcquisitionIdentity | MovieAcquisitionIdentity,
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
  identity: DefaultAcquisitionIdentity | MovieAcquisitionIdentity,
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
  const current =
    evidence.schemaVersion === 1
      ? legacyFileIdentityEvidence(identity, file)
      : fileIdentityEvidence(identity, file);
  if (
    identityHash(current) !== identityHash(evidence) ||
    String(file.size) !== entry.sizeBytes ||
    identityHash([...current.coverage].sort()) !==
      identityHash([...entry.mediaIds].sort())
  )
    throw new FileGuardError("file_identity_changed");
}
