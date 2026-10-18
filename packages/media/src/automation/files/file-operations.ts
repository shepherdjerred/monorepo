import { FileOperations } from "#filesystem/operations.ts";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";
import type { FileContext } from "./types.ts";

export function fileOperations(
  context: FileContext,
  roots: MediaFileRoots,
  authorize: () => Promise<void>,
  beforeEffect?: () => void,
): FileOperations {
  return new FileOperations(roots, {
    authorize: async () => {
      await authorize();
      await context.verifyStorageAuthority(roots);
    },
    checkpoint: context.checkpoint,
    ...(beforeEffect === undefined ? {} : { beforeEffect }),
    ...(context.contentProof === undefined
      ? {}
      : { contentProof: context.contentProof }),
    ...(context.minimumFreeBytes === undefined
      ? {}
      : { minimumFreeBytes: context.minimumFreeBytes }),
    ...(context.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.verifyPlexExclusion }),
  });
}
