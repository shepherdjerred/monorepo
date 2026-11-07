import path from "node:path";
import type { FileContext } from "#automation/files/types.ts";
import {
  storedFilePath,
  workerFilePath,
} from "#automation/files/paths/locations.ts";
import { safePath } from "#filesystem/operations-io.ts";

/** Constructor-owned mapping changes only IO; approved paths and all persisted hashes remain canonical. */
export async function handoffWorkerPath(
  context: FileContext,
  kind: "movies" | "tv",
  canonicalPath: string,
) {
  const local = workerFilePath(context, canonicalPath);
  const relative = path.relative(context.roots[kind].library, local);
  const target = await safePath(context.roots[kind].library, relative, false);
  if (
    target !== local ||
    storedFilePath(context, kind, "library", relative) !== canonicalPath
  )
    throw new Error(
      "Handoff target does not match its exact canonical and worker roots",
    );
  return target;
}
