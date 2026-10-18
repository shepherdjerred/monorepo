import path from "node:path";
import { FileOperations } from "#filesystem/operations.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { assertArchiveActive, type ArchiveFileContext } from "./execution.ts";
import { archiveOriginalJournals } from "./paths.ts";
import {
  assertCleanupContent,
  archiveCleanupSubtitleDependencies,
} from "./cleanup-proof.ts";
import type { ArchiveCleanupProof } from "./cleanup-types.ts";
import { archivePurgeManifest } from "./purge-manifest.ts";
import { assertCleanupJournalProof } from "./journal-proof.ts";

export async function withCleanupLocks<T>(
  context: ArchiveFileContext,
  proof: ArchiveCleanupProof,
  authorize: () => Promise<() => void>,
  action: (operations: Map<"movies" | "tv", FileOperations>) => Promise<T>,
): Promise<T> {
  const operations = new Map<"movies" | "tv", FileOperations>();
  let beforeEffect: (() => void) | undefined;
  const check = async () => {
    beforeEffect = await authorize();
  };
  const kinds = ["movies", "tv"] as const;
  const journals = [
    ...archiveOriginalJournals(context, proof.scope),
    ...proof.execution.participants.map((item) =>
      archivePurgeManifest(context, proof.execution.continuationId, item),
    ),
  ];
  const enter = async (index: number): Promise<T> => {
    const kind = kinds[index];
    if (kind === undefined) {
      assertArchiveActive(context.execution);
      await assertCleanupContent(context, proof);
      await assertCleanupJournalProof(context, proof);
      await check();
      const result = await action(operations);
      await assertCleanupContent(context, proof);
      await assertCleanupJournalProof(context, proof);
      assertArchiveActive(context.execution);
      return result;
    }
    const roots = context.files.roots[kind];
    const selected = proof.paths.filter((name) =>
      name.startsWith(`/data/${kind}/`),
    );
    if (selected.length === 0) return await enter(index + 1);
    const instance = new FileOperations(roots, {
      authorize: check,
      beforeEffect: () => {
        if (beforeEffect === undefined)
          throw new Error("Archive effect authority was not captured");
        beforeEffect();
      },
      contentProof: proof.content,
      checkpoint: context.files.checkpoint,
      ...(context.files.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
    });
    operations.set(kind, instance);
    return await instance.withContentPaths(
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
        ...archiveCleanupSubtitleDependencies(proof.descriptor)
          .filter((item) => item.kind === kind)
          .flatMap((item) => item.operationIds),
      ],
    );
  };
  return await enter(0);
}
