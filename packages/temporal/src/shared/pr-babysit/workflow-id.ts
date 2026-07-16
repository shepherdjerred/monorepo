/**
 * Stable per-PR workflow id for the babysitter. One workflow per PR, so a
 * redelivered webhook / repeated command signals the live run instead of
 * starting a second loop. Pure (no I/O) — safe in the workflow bundle.
 */
import { sanitizeTemporalIdPart } from "#shared/agent-task.ts";

export function prBabysitWorkflowId(
  owner: string,
  repo: string,
  prNumber: number,
): string {
  const o = sanitizeTemporalIdPart(owner) || "owner";
  const r = sanitizeTemporalIdPart(repo) || "repo";
  return `pr-babysit-${o}-${r}-${String(prNumber)}`;
}
