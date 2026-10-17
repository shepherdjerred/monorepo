import path from "node:path";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { z } from "zod";
import { ContentProof } from "#filesystem/content-proof.ts";
import {
  safePath,
  verifyControlExclusion,
  syncFile,
  syncDirectory,
  exists,
} from "#filesystem/operations-io.ts";
import { ManifestSchema } from "#filesystem/operations-types.ts";
import type { SubtitleReplacement } from "#generated/prisma/client.ts";
import {
  SubtitleReplacementSnapshotSchema,
  SubtitleReplacementObservationSchema,
} from "#shared/subtitle-replacement.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { unmanagedSidecars } from "#automation/handoff/sidecars.ts";
import {
  FileGuardError,
  now,
  type FileContext,
} from "#automation/files/types.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import { replacementCandidateBytes } from "./candidate.ts";

export function replacementPaths(
  context: FileContext,
  row: SubtitleReplacement,
) {
  const scope = SubtitleReplacementSnapshotSchema.parse(row.snapshot);
  const roots = context.roots[scope.libraryKind];
  const format = z
    .enum(["srt", "ass", "ssa", "vtt"])
    .parse(path.extname(scope.destination).slice(1));
  const sourceRelative = `subtitles/replacement-${row.id}.${format}`;
  return {
    scope,
    roots,
    sourceRelative,
    video: scope.asset.path,
    target: scope.destination,
    source: path.join(roots.control, sourceRelative),
    staged: path.join(roots.control, `staging/${row.importOperationId}`),
    partial: path.join(
      roots.control,
      `staging/${row.importOperationId}.partial`,
    ),
    oldArchive: path.join(roots.control, `rollback/${row.importOperationId}`),
    rejected: path.join(roots.control, `rollback/${row.rollbackOperationId}`),
    rollbackStaged: path.join(
      roots.control,
      `staging/${row.rollbackOperationId}`,
    ),
    descriptor: {
      operationId: row.importOperationId,
      downloadPath: sourceRelative,
      libraryPath: path.relative(roots.library, scope.destination),
      sha256: z.string().parse(scope.candidate.checksum),
      previousSha256: z.string().parse(scope.old.checksum),
    },
  };
}
export type ReplacementPaths = ReturnType<typeof replacementPaths>;

export async function replacementNeighbors(paths: ReplacementPaths) {
  const neighbors = await unmanagedSidecars(paths.video);
  const actual = neighbors.map((item) => item.canonicalPath).sort();
  const expected = paths.scope.installed
    .flatMap((item) =>
      item.storageKind === "sidecar" && item.path !== null ? [item.path] : [],
    )
    .sort();
  if (
    new Set(expected).size !== expected.length ||
    snapshotHash(actual) !== snapshotHash(expected)
  )
    throw new FileGuardError("subtitle_replacement_neighbor_unowned");
  return actual;
}

/** Read-only preparation. No staging, lock directories or journal files are created. */
export async function observeReplacement(
  context: FileContext,
  row: SubtitleReplacement,
) {
  const paths = replacementPaths(context, row);
  await context.verifyStorageAuthority(paths.roots);
  await verifyControlExclusion(paths.roots, context.verifyPlexExclusion);
  const content = new ContentProof();
  for (const filename of [paths.video, paths.target]) {
    if (
      (await safePath(
        paths.roots.library,
        path.relative(paths.roots.library, filename),
        false,
      )) !== filename
    )
      throw new FileGuardError("subtitle_replacement_path_changed");
    await content.capture(filename, () =>
      context.checkpoint("replacement-hashing"),
    );
  }
  const neighbors = await replacementNeighbors(paths);
  content.seal();
  const video = await content.verifiedFile(paths.video);
  const old = await content.verifiedFile(paths.target);
  if (
    video.sha256 !== paths.scope.asset.checksum ||
    old.sha256 !== paths.scope.old.checksum
  )
    throw new FileGuardError("subtitle_replacement_bytes_changed");
  return {
    content,
    paths,
    observation: SubtitleReplacementObservationSchema.parse({
      schemaVersion: 1,
      snapshotHash: row.snapshotHash,
      capturedAt: now(context).toISOString(),
      video: {
        checksum: video.sha256,
        sizeBytes: video.sizeBytes,
        identity: await content.reviewIdentity(paths.video),
      },
      old: {
        checksum: old.sha256,
        sizeBytes: old.sizeBytes,
        identity: await content.reviewIdentity(paths.target),
      },
      neighbors,
    }),
  };
}

export async function stageReplacement(
  context: FileContext,
  row: SubtitleReplacement,
) {
  const paths = replacementPaths(context, row);
  await context.verifyStorageAuthority(paths.roots);
  await verifyControlExclusion(paths.roots, context.verifyPlexExclusion);
  const candidate = await context.db.subtitleAsset.findUniqueOrThrow({
    where: { id: row.candidateSubtitleId },
  });
  const { bytes } = replacementCandidateBytes(candidate);
  const source = await safePath(
    paths.roots.control,
    paths.sourceRelative,
    true,
  );
  if (
    row.executionEvidence === null &&
    ((await exists(source)) ||
      (await exists(paths.staged)) ||
      (await exists(paths.partial)))
  )
    throw new FileGuardError(
      "subtitle_replacement_artifact_ownership_unconfirmed",
    );
  try {
    await writeFile(source, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!z.object({ code: z.literal("EEXIST") }).safeParse(error).success)
      throw error;
    const info = await lstat(source);
    if (
      !info.isFile() ||
      info.size > 8 * 1024 * 1024 ||
      !bytes.equals(await readFile(source))
    )
      throw new FileGuardError("subtitle_replacement_source_collision");
  }
  await syncFile(source);
  await syncDirectory(path.dirname(source));
  await fileOperations(
    context,
    { ...paths.roots, downloads: paths.roots.control },
    () => Promise.reject(new Error("Replacement staging cannot publish")),
  ).importFile({ ...paths.descriptor, stopAfterStaging: true });
}

/** All large reads precede PG locks; final effects receive this exact one-use capability. */
export async function proveReplacement(
  context: FileContext,
  row: SubtitleReplacement,
) {
  const paths = replacementPaths(context, row);
  await context.verifyStorageAuthority(paths.roots);
  await verifyControlExclusion(paths.roots, context.verifyPlexExclusion);
  const content = new ContentProof();
  for (const filename of [
    paths.video,
    paths.target,
    paths.source,
    paths.staged,
    paths.partial,
    paths.oldArchive,
    paths.rejected,
    paths.rollbackStaged,
  ]) {
    const root = [paths.video, paths.target].includes(filename)
      ? paths.roots.library
      : paths.roots.control;
    await safePath(root, path.relative(root, filename), true);
    await content.capture(filename, () =>
      context.checkpoint("replacement-hashing"),
    );
  }
  const neighbors = await replacementNeighbors(paths);
  content.seal();
  if ((await content.digest(paths.video)) !== paths.scope.asset.checksum)
    throw new FileGuardError("subtitle_replacement_video_changed");
  return { paths, content, neighbors };
}
export type ReplacementProof = Awaited<ReturnType<typeof proveReplacement>>;

export async function readReplacementJournal(
  paths: ReplacementPaths,
  operationId: string,
) {
  try {
    const filename = await safePath(
      paths.roots.control,
      `journal/${operationId}.json`,
      false,
    );
    const info = await lstat(filename);
    if (!info.isFile() || info.size > 64 * 1024)
      throw new FileGuardError("subtitle_replacement_journal_unsafe");
    return ManifestSchema.parse(JSON.parse(await readFile(filename, "utf8")));
  } catch (error) {
    if (z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      return null;
    throw error;
  }
}

export async function assertReviewedProof(
  proof: ReplacementProof,
  observation: unknown,
  targetIsOld: boolean,
) {
  const expected = SubtitleReplacementObservationSchema.parse(observation);
  if (
    snapshotHash(await proof.content.reviewIdentity(proof.paths.video)) !==
      snapshotHash(expected.video.identity) ||
    snapshotHash(proof.neighbors) !== snapshotHash(expected.neighbors)
  )
    throw new FileGuardError("subtitle_replacement_review_changed");
  if (
    targetIsOld &&
    snapshotHash(await proof.content.reviewIdentity(proof.paths.target)) !==
      snapshotHash(expected.old.identity)
  )
    throw new FileGuardError("subtitle_replacement_review_changed");
}
