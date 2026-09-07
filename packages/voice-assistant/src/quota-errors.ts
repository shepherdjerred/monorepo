import { z } from "zod";
/**
 * Distinguishes "the account is out of money" from ordinary transient failures.
 *
 * The production spend ceiling is enforced on the OpenAI project token, so exhausting it is an
 * expected recurring state, not a fault. It needs different handling from a transient error: the
 * user should be told once and accurately, and the local cascade should stop reaching for the
 * network until the period rolls over.
 *
 * Deliberately narrow. A bare HTTP 429 is ordinary rate limiting and must NOT match, or a busy
 * minute would silently mute voice for an hour.
 */

/** OpenAI's documented spend-refusal codes, plus the human-readable text that accompanies them. */
const QUOTA_MARKERS = [
  "insufficient_quota",
  "billing_hard_limit_reached",
  "exceeded your current quota",
  "check your plan and billing",
] as const;

export function isQuotaExhaustedError(error: unknown): boolean {
  const haystack = quotaHaystack(error).toLowerCase();
  if (haystack.length === 0) return false;
  return QUOTA_MARKERS.some((marker) => haystack.includes(marker));
}

/** OpenAI SDK errors carry a structured `code`/`type` alongside the message, and may wrap a cause. */
const ErrorShapeSchema = z.looseObject({
  message: z.string().optional(),
  code: z.string().optional(),
  type: z.string().optional(),
  cause: z.unknown().optional(),
});

function quotaHaystack(error: unknown, depth = 0): string {
  if (typeof error === "string") return error;
  // Bounded so a self-referential or deeply nested cause chain cannot spin.
  if (depth > 4) return "";
  const parsed = ErrorShapeSchema.safeParse(error);
  if (!parsed.success) return "";
  const { message, code, type, cause } = parsed.data;
  const parts = [message, code, type].filter(
    (part) => typeof part === "string",
  );
  if (cause !== undefined && cause !== error) {
    parts.push(quotaHaystack(cause, depth + 1));
  }
  return parts.join(" ");
}
