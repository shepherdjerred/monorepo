import { FileOperations } from "#filesystem/operations.ts";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";
import type { FileContext } from "./types.ts";

export function fileOperations(
  context: FileContext,
  roots: MediaFileRoots,
  authorize: () => Promise<void>,
): FileOperations {
  return new FileOperations(roots, {
    authorize,
    checkpoint: context.checkpoint,
    ...(context.minimumFreeBytes === undefined
      ? {}
      : { minimumFreeBytes: context.minimumFreeBytes }),
    ...(context.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.verifyPlexExclusion }),
  });
}
