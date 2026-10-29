import path from "node:path";
import type { MediaFileRoots } from "#filesystem/operations-types.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import { safePath } from "#filesystem/operations-io.ts";

/** Resolve the most specific root first: excluded control may be inside library. */
export async function publicationPath(roots: MediaFileRoots, absolute: string) {
  for (const root of ["control", "library"] as const) {
    const relative = path.relative(roots[root], absolute);
    if (
      relative !== ".." &&
      relative.length > 0 &&
      !path.isAbsolute(relative) &&
      !relative.startsWith(`..${path.sep}`)
    ) {
      if ((await safePath(roots[root], relative, false)) !== absolute)
        throw new FileOperationConflict("Publication path identity changed");
      return { root, path: relative };
    }
  }
  throw new FileOperationConflict("Publication effect outside validated roots");
}
