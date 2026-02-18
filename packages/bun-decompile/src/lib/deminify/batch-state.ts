import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { hashSource } from "./cache.ts";

/** Persisted batch state for resume support */
export type BatchState = {
  /** Batch ID from Anthropic API */
  batchId: string;
  /** Hash of source file for verification */
  sourceHash: string;
  /** Output path for results */
  outputPath: string;
  /** Creation timestamp */
  createdAt: number;
  /** Model used */
  model: string;
  /** Number of functions in batch */
  functionCount: number;
  /** Original file name */
  fileName: string;
  /** Project identifier to prevent cross-project batch resumption */
  projectId: string;
};

const STATE_FILE_PREFIX = "pending-batch";

/**
 * Generate a project identifier based on the current working directory.
 * This prevents different projects/users from resuming each other's batches
 * when sharing a cache directory (e.g., in CI environments).
 */
function getProjectId(): string {
  const cwd = process.cwd();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(cwd);
  return hasher.digest("hex").slice(0, 8);
}

/** Export for use in state verification and creation */
export { getProjectId };

/** Get the path to the state file (includes project ID for isolation) */
function getStatePath(cacheDir: string): string {
  const projectId = getProjectId();
  return path.join(cacheDir, `${STATE_FILE_PREFIX}-${projectId}.json`);
}

/** Save batch state to disk */
export async function saveBatchState(
  state: BatchState,
  cacheDir: string,
): Promise<void> {
  const statePath = getStatePath(cacheDir);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/** Load batch state from disk */
export async function loadBatchState(
  cacheDir: string,
): Promise<BatchState | null> {
  try {
    const statePath = getStatePath(cacheDir);
    const content = await readFile(statePath, "utf8");
    // eslint-disable-next-line custom-rules/no-type-assertions -- AST node type narrowing requires assertion
    return JSON.parse(content) as BatchState;
  } catch {
    return null;
  }
}

/** Clear saved batch state */
export async function clearBatchState(cacheDir: string): Promise<void> {
  try {
    const statePath = getStatePath(cacheDir);
    await unlink(statePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/** Verify that saved state matches current source and project */
export function verifyBatchState(state: BatchState, source: string): boolean {
  // Verify both source hash and project ID match
  const projectMatches = state.projectId === getProjectId();
  const sourceMatches = state.sourceHash === hashSource(source);
  return projectMatches && sourceMatches;
}

/** Format batch state for display */
export function formatBatchState(state: BatchState): string {
  const age = Date.now() - state.createdAt;
  const ageMinutes = Math.floor(age / 60_000);
  const ageStr =
    ageMinutes < 60
      ? `${String(ageMinutes)}m ago`
      : `${String(Math.floor(ageMinutes / 60))}h ${String(ageMinutes % 60)}m ago`;

  return [
    `Batch ID: ${state.batchId}`,
    `File: ${state.fileName}`,
    `Functions: ${String(state.functionCount)}`,
    `Model: ${state.model}`,
    `Created: ${ageStr}`,
    `Output: ${state.outputPath}`,
  ].join("\n");
}
