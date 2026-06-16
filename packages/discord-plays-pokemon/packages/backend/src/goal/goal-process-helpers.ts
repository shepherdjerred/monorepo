// Small helpers shared by GoalManager. Lives here so goal-manager.ts can
// stay focused on lifecycle + concurrency without tripping the per-file
// line cap.

import { logger } from "#src/logger.ts";
import type { GoalProcessSpawner } from "./goal-manager.ts";

export const defaultSpawner: GoalProcessSpawner = (args, options) => {
  return Bun.spawn(args, {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
};

export async function streamToLog(
  stream: ReadableStream<Uint8Array> | null,
  label: string,
): Promise<void> {
  if (stream === null) {
    return;
  }

  const text = await new Response(stream).text();
  const trimmed = text.trim();
  if (trimmed.length > 0) {
    logger.info(`goal codex ${label}: ${trimmed}`);
  }
}
