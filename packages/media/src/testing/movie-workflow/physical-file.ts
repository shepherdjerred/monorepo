import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * A polled observation of one physical file: its checksum, or null when absent.
 *
 * Role fixtures sample evidence while the workflow moves files between the
 * library and quarantine, so read once and treat only ENOENT as absence. An
 * exists-then-read check fails when a move lands between the two calls.
 */
export async function physicalFile(filename: string) {
  try {
    return {
      filename,
      checksum: createHash("sha256")
        .update(await readFile(filename))
        .digest("hex"),
    };
  } catch (error) {
    if (!z.object({ code: z.literal("ENOENT") }).safeParse(error).success)
      throw error;
    return { filename, checksum: null };
  }
}
