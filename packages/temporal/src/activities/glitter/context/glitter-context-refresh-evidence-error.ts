/**
 * Raised when a person's corpus evidence cannot produce a usable style card —
 * the model would not summarize their chunks, or would not synthesize a card
 * that satisfies the contract, after every bounded repair.
 *
 * This is deliberately a distinct type rather than a plain `Error`. The refresh
 * activity skips a person and continues on this and only this: retrying would
 * replay the same cached artifacts and reach the same answer, so failing the
 * whole run would strand everyone else for one person's evidence.
 *
 * Everything else — a transient S3 read, a filesystem write, a parse error, a
 * cancellation — must keep escaping, because Temporal's activity retry is what
 * recovers those, and converting one into a "skipped person" silently turns a
 * recoverable blip into a stale card plus a PR that looks complete.
 */
export class GlitterEvidenceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GlitterEvidenceError";
  }
}
