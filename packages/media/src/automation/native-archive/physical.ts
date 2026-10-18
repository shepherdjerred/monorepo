import path from "node:path";
import { FileOperations } from "#filesystem/operations.ts";
import { verifyJournalProof } from "#automation/handoff/journals.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { nativePhysicalIdentity } from "#infrastructure/native-archive/physical-identity.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { archiveAllPaths, archiveOriginalJournals } from "./paths.ts";
import {
  verifyArchiveOriginalJournals,
  type PreparedNativeArchive,
} from "./files.ts";
import { assertArchiveNeighbors } from "./subtitle-proof.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import {
  assertArchiveAuthorityProof,
  archiveSubtitleAuthorityEvidence,
} from "./authority-proof.ts";
import { archiveSupersessionEvidence } from "./supersession-proof.ts";
import { archivePurgeId } from "./purge-manifest.ts";

export async function assertArchivePhysical(
  context: ArchiveFileContext,
  prepared: PreparedNativeArchive,
) {
  assertArchiveActive(context.execution);
  await assertArchiveAuthorityProof(
    context,
    prepared.content,
    prepared.authorityProof.participants,
  );
  const subtitleEvidence = await archiveSubtitleAuthorityEvidence(
    context,
    prepared.content,
    prepared.authorityProof,
  );
  if (
    snapshotHash(subtitleEvidence) !==
    snapshotHash(prepared.evidence.subtitleEvidence ?? [])
  )
    throw new Error("Archive subtitle authority evidence changed");
  await archiveSupersessionEvidence(
    context,
    prepared.content,
    prepared.supersessions,
  );
  for (const file of prepared.evidence.files)
    await assertArchiveFile(context, prepared, file);
  for (const file of prepared.evidence.artifactAbsences)
    await prepared.content.reviewAbsence(
      nativeLocalPath(context, file.canonicalPath),
    );
  for (const terminal of prepared.evidence.terminalEvidence)
    for (const file of terminal.files)
      if (
        (await prepared.content.digest(
          nativeLocalPath(context, file.canonicalPath),
        )) !== file.sha256
      )
        throw new Error("Archive terminal evidence changed");
  await assertArchiveNeighbors(context, prepared.scope);
  await verifyArchiveOriginalJournals(context, prepared.scope);
  for (const journal of prepared.journals) await verifyJournalProof(journal);
  assertArchiveActive(context.execution);
}

async function assertArchiveFile(
  context: ArchiveFileContext,
  prepared: PreparedNativeArchive,
  file: PreparedNativeArchive["evidence"]["files"][number],
) {
  if (
    (await prepared.content.digest(
      nativeLocalPath(context, file.canonicalPath),
    )) !== file.checksum
  )
    throw new Error("Archive video identity changed");
  for (const subtitle of file.subtitles)
    if (
      subtitle.canonicalPath !== null &&
      (await prepared.content.digest(
        nativeLocalPath(context, subtitle.canonicalPath),
      )) !== subtitle.checksum
    )
      throw new Error("Archive sidecar identity changed");
  const scopeFile = prepared.scope.files.find(
    (item) => item.assetId === file.assetId,
  );
  if (scopeFile === undefined)
    throw new Error("Archive physical participant is not reviewed");
  if (
    scopeFile.authority.kind === "prior_native_binding" &&
    scopeFile.authority.subtitleLineage === undefined &&
    snapshotHash(nativePhysicalIdentity(file)) !==
      scopeFile.authority.physicalEvidenceHash
  )
    throw new Error("Archive prior grant physical identity changed");
}

/** Exact operation locks precede sorted path locks; the callback already owns PG authority. */
export async function withArchiveLocks<T>(
  context: ArchiveFileContext,
  prepared: PreparedNativeArchive,
  action: () => Promise<T>,
): Promise<T> {
  const kinds = ["movies", "tv"] as const;
  const paths = [
    ...new Set([
      ...archiveAllPaths(prepared.scope),
      ...prepared.authorityProof.paths,
      ...prepared.supersessions.paths,
    ]),
  ].sort();
  const journals = archiveOriginalJournals(context, prepared.scope);
  const enter = async (index: number): Promise<T> => {
    const kind = kinds[index];
    if (kind === undefined) {
      await assertArchivePhysical(context, prepared);
      const result = await action();
      await assertArchivePhysical(context, prepared);
      return result;
    }
    const roots = context.files.roots[kind];
    const selected = paths.filter((name) => name.startsWith(`/data/${kind}/`));
    if (selected.length === 0) return await enter(index + 1);
    const operations = new FileOperations(roots, {
      authorize: () =>
        Promise.reject(new Error("Archive review cannot mutate files")),
      contentProof: prepared.content,
      checkpoint: context.files.checkpoint,
      ...(context.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
    });
    return await operations.withContentPaths(
      selected.map((name) => {
        const control = name.startsWith(`/data/${kind}/.media-control/`);
        return {
          root: control ? ("control" as const) : ("library" as const),
          path: path.relative(
            control ? roots.control : roots.library,
            nativeLocalPath(context, name),
          ),
        };
      }),
      () => enter(index + 1),
      [
        ...journals
          .filter(
            (journal) =>
              journal.target.startsWith(roots.library + path.sep) ||
              journal.target.startsWith(roots.control + path.sep),
          )
          .map((journal) => journal.operationId),
        ...prepared.supersessions.selections.flatMap((selection) =>
          selection.participants
            .filter((item) => item.libraryKind === kind)
            .map((item) =>
              archivePurgeId(
                selection.target.continuationId,
                item.canonicalPath,
              ),
            ),
        ),
        ...prepared.authorityProof.subtitleLineages
          .filter((item) => item.prepared.kind === kind)
          .flatMap((item) => item.prepared.operationIds),
      ],
    );
  };
  return await enter(0);
}
