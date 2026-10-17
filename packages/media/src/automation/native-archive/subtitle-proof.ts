import path from "node:path";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { lstat } from "node:fs/promises";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { MediaProbe } from "#filesystem/media-tools.ts";
import { safePath } from "#filesystem/operations-io.ts";
import type {
  NativeArchiveFile,
  NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import { NativeSubtitleEvidenceSchema } from "#shared/native-subtitles.ts";
import { nativeEmbeddedStream } from "#automation/native-subtitles/proof.ts";
import { unmanagedSidecars } from "#automation/handoff/sidecars.ts";
import {
  nativeLocalPath,
  type NativeFileContext,
} from "#automation/native-recovery/files.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { assertArchiveSubtitleBindings } from "./subtitles.ts";

export async function captureArchiveSubtitles(
  context: NativeFileContext,
  file: NativeArchiveFile,
  content: ContentProof,
  probe: MediaProbe,
) {
  assertArchiveSubtitleBindings(file);
  const streams = new Map<string, ReturnType<typeof nativeEmbeddedStream>>();
  for (const subtitle of file.subtitles) {
    if (subtitle.storageKind === "embedded") {
      streams.set(subtitle.id, nativeEmbeddedStream(probe, subtitle));
      continue;
    }
    if (subtitle.path === null)
      throw new Error("Archive sidecar path is missing");
    const local = nativeLocalPath(context, subtitle.path);
    const root = subtitle.path.startsWith(
      `/data/${file.libraryKind}/.media-control/`,
    )
      ? context.files.roots[file.libraryKind].control
      : context.files.roots[file.libraryKind].library;
    await safePath(root, path.relative(root, local), false);
    const info = await lstat(local);
    if (info.size > 8 * 1024 * 1024)
      throw new Error("Archive sidecar exceeds inspection bound");
    await content.capture(local, () =>
      context.files.checkpoint("native-archive-subtitle-hashing"),
    );
  }
  return { file, streams };
}

export async function archiveSubtitleEvidence(
  context: NativeFileContext,
  content: ContentProof,
  captured: Awaited<ReturnType<typeof captureArchiveSubtitles>>,
) {
  const result = [];
  for (const subtitle of captured.file.subtitles) {
    const local =
      subtitle.path === null ? null : nativeLocalPath(context, subtitle.path);
    const proof = local === null ? null : await content.verifiedFile(local);
    if (proof !== null && proof.sha256 !== subtitle.checksum)
      throw new Error("Archive sidecar bytes changed");
    result.push(
      NativeSubtitleEvidenceSchema.parse({
        id: subtitle.id,
        assetId: subtitle.assetId,
        snapshotHash: snapshotHash(subtitle),
        videoChecksum: captured.file.checksum,
        canonicalPath: subtitle.path,
        checksum: proof?.sha256 ?? subtitle.checksum,
        sizeBytes: proof?.sizeBytes ?? null,
        identity: local === null ? null : await content.reviewIdentity(local),
        storageKind: subtitle.storageKind,
        qualityStatus: subtitle.qualityStatus,
        stream: captured.streams.get(subtitle.id) ?? null,
      }),
    );
  }
  return result;
}

/** Inventory real library neighbors, not unrelated files sharing the control quarantine directory. */
export async function assertArchiveNeighbors(
  context: NativeFileContext,
  scope: NativeArchiveScope,
) {
  const canonical = [
    ...new Set([
      ...scope.files
        .filter((file) => file.state === "published")
        .map((file) => file.canonicalPath),
      ...scope.edges.map(
        (edge) =>
          `/data/${edge.publicationAttempt.entry.libraryKind}/${edge.publicationAttempt.entry.libraryPath}`,
      ),
    ]),
  ];
  const expected = new Set(
    scope.files.flatMap((file) =>
      file.subtitles.flatMap((subtitle) =>
        subtitle.path === null ? [] : [nativeLocalPath(context, subtitle.path)],
      ),
    ),
  );
  for (const name of canonical)
    for (const neighbor of await unmanagedSidecars(
      nativeLocalPath(context, name),
    ))
      if (!expected.has(neighbor.canonicalPath))
        throw new FileOperationConflict(
          "Archive library neighbors contain an unowned sidecar",
        );
}
