import path from "node:path";
import { readdir } from "node:fs/promises";
import { RunSchema, type CaptureRun } from "./model.ts";

/** An account must finish recovery before it can accumulate another abandoned site. */
export async function assertNoPendingRun(
  directory: string,
  run: CaptureRun,
): Promise<void> {
  const parent = path.dirname(directory);
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith("capture-") ||
      entry.name === path.basename(directory)
    )
      continue;
    const previous = RunSchema.parse(
      await Bun.file(path.join(parent, entry.name, "run.json")).json(),
    );
    if (
      previous.target === run.target &&
      previous.name === run.name &&
      previous.checkpoint !== null &&
      !["complete", "failed"].includes(previous.state)
    )
      throw new Error(
        `Recover ${previous.id} before starting another scene for ${run.name}`,
      );
  }
}
