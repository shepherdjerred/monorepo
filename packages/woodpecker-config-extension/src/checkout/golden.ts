import { lstat, readdir, rename, rm } from "node:fs/promises";
import nodePath from "node:path";
import { z } from "zod";
import { CommitSchema } from "./git.ts";

/**
 * A workspace cloned from the golden snapshot starts as the golden checkout:
 * a main commit with dependencies installed. This untracked file at the
 * repository root names that commit. Checkout moves the clone to the requested
 * commit and removes the file, so its presence means "unconverted clone".
 */
export const GOLDEN_MARKER = ".ci-golden";
/** Where the maintenance publisher mounts the golden claim. */
export const GOLDEN_ROOT = "/woodpecker/golden";
/** Where Woodpecker mounts each workflow's workspace claim. */
export const WORKSPACE_ROOT = "/woodpecker";

export const GoldenMarkerSchema = z.object({
  version: z.literal(1),
  commit: CommitSchema,
});
export type GoldenMarker = z.infer<typeof GoldenMarkerSchema>;

export async function goldenMarker(
  workspace: string,
): Promise<GoldenMarker | undefined> {
  const path = nodePath.join(workspace, GOLDEN_MARKER);
  try {
    const info = await lstat(path);
    if (!info.isFile())
      throw new Error("Golden workspace marker is not a file");
  } catch (error) {
    if (missing(error)) return undefined;
    throw error;
  }
  return GoldenMarkerSchema.parse(await Bun.file(path).json());
}

/** Removes everything a golden clone brought, leaving an empty workspace. */
export async function clearWorkspace(workspace: string): Promise<void> {
  for (const entry of await readdir(workspace))
    await rm(nodePath.join(workspace, entry), { recursive: true, force: true });
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Moves a complete tree to `target`, retiring any tree already there. The
 * golden claim may be snapshotted at any moment, and a recursive delete or
 * copy in place would leave a snapshot with a partial checkout, possibly
 * still marked. Renames leave only the old tree, no tree, or the new tree;
 * a clone of "no tree" is an ordinary empty workspace.
 */
export async function replaceTree(
  staging: string,
  target: string,
): Promise<void> {
  const retired = `${target}.retired`;
  await rm(retired, { recursive: true, force: true });
  try {
    await rename(target, retired);
  } catch (error) {
    if (!missing(error)) throw error;
  }
  await rename(staging, target);
  await rm(retired, { recursive: true, force: true });
}
