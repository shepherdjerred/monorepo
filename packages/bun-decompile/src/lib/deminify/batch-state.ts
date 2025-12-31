import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { hashSource } from "./cache.ts";

/** Persisted batch state for resume support */
export interface BatchState {
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
}

const STATE_DIR = ".bun-decompile-cache";
const STATE_FILE = "pending-batch.json";

/** Get the path to the state file */
function getStatePath(cacheDir?: string): string {
  return join(cacheDir ?? STATE_DIR, STATE_FILE);
}

/** Save batch state to disk */
export async function saveBatchState(
  state: BatchState,
  cacheDir?: string,
): Promise<void> {
  const statePath = getStatePath(cacheDir);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/** Load batch state from disk */
export async function loadBatchState(
  cacheDir?: string,
): Promise<BatchState | null> {
  try {
    const statePath = getStatePath(cacheDir);
    const content = await readFile(statePath, "utf-8");
    return JSON.parse(content) as BatchState;
  } catch {
    return null;
  }
}

/** Clear saved batch state */
export async function clearBatchState(cacheDir?: string): Promise<void> {
  try {
    const statePath = getStatePath(cacheDir);
    await unlink(statePath);
  } catch {
    // Ignore if file doesn't exist
  }
}

/** Verify that saved state matches current source */
export function verifyBatchState(
  state: BatchState,
  source: string,
): boolean {
  return state.sourceHash === hashSource(source);
}

/** Format batch state for display */
export function formatBatchState(state: BatchState): string {
  const age = Date.now() - state.createdAt;
  const ageMinutes = Math.floor(age / 60000);
  const ageStr = ageMinutes < 60
    ? `${ageMinutes}m ago`
    : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;

  return [
    `Batch ID: ${state.batchId}`,
    `File: ${state.fileName}`,
    `Functions: ${state.functionCount}`,
    `Model: ${state.model}`,
    `Created: ${ageStr}`,
    `Output: ${state.outputPath}`,
  ].join("\n");
}
