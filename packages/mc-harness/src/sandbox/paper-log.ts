/** Paper console markers every provider reads while a server boots. */

/** Paper's console line once the server accepts connections. */
export const PAPER_DONE_PATTERN = /Done \(\d+\.\d+s\)! For help/u;

/** Console lines that mean a plugin failed to start; the server keeps running. */
export const PLUGIN_FAILURE_PATTERNS: readonly string[] = [
  "Error occurred while enabling",
  "Could not load 'plugins/",
];

/** Throws with the log tail when any failure pattern appears in the console. */
export function assertNoPluginFailures(
  logs: string,
  patterns: readonly string[] = PLUGIN_FAILURE_PATTERNS,
): void {
  const hit = patterns.find((pattern) => logs.includes(pattern));
  if (hit !== undefined) {
    throw new Error(
      `Server plugin startup failed (${hit}):\n${logs.slice(-12_000)}`,
    );
  }
}
