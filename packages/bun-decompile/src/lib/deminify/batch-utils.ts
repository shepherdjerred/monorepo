/**
 * Batch mode utility functions.
 */

import type { BatchStatus } from "./batch-client.ts";
import type { OpenAIBatchStatus } from "./openai-batch.ts";

/** Convert OpenAI batch status to common BatchStatus */
export function toCommonStatus(status: OpenAIBatchStatus): BatchStatus {
  return {
    batchId: status.batchId,
    status: status.status === "completed" ? "ended" : "in_progress",
    total: status.total,
    succeeded: status.completed,
    errored: status.failed,
    processing: status.total - status.completed - status.failed,
  };
}

/** Format batch progress for terminal display */
export function formatBatchProgress(
  completed: number,
  total: number,
  failed: number,
): string {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return `\r  Progress: ${String(completed)}/${String(total)} (${String(pct)}%) | Errors: ${String(failed)}     `;
}
