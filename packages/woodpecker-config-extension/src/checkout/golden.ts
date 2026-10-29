import { lstat, readdir, rm } from "node:fs/promises";
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
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
  return GoldenMarkerSchema.parse(await Bun.file(path).json());
}

/** Removes everything a golden clone brought, leaving an empty workspace. */
export async function clearWorkspace(workspace: string): Promise<void> {
  for (const entry of await readdir(workspace))
    await rm(nodePath.join(workspace, entry), { recursive: true, force: true });
}
