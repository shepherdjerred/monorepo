import { z } from "zod";
import type { ReviewProvider } from "../types.ts";
import { codexProvider } from "./codex.ts";
import { greptileProvider } from "./greptile.ts";
import { qodoProvider } from "./qodo.ts";

/** Every registered review provider, keyed by its stable id. */
export const PROVIDERS = {
  codex: codexProvider,
  greptile: greptileProvider,
  qodo: qodoProvider,
} as const;

// Keep these ids in sync with the keys of PROVIDERS above.
export const ProviderIdSchema = z.enum(["codex", "greptile", "qodo"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/** The hosted provider whose findings are required by the repository CI gate. */
export const REQUIRED_REVIEW_PROVIDER_ID: ProviderId = "qodo";

/**
 * The shared default for provider-neutral consumers such as PR fleet. CI pins
 * its required Qodo provider explicitly at the wait-for-review boundary.
 */
export const DEFAULT_PROVIDER_ID: ProviderId = "codex";

/** Resolve the repository-required provider without changing neutral defaults. */
export function resolveRequiredReviewProvider(): ReviewProvider {
  return PROVIDERS[REQUIRED_REVIEW_PROVIDER_ID];
}

/**
 * Resolve a provider by id (defaulting to {@link DEFAULT_PROVIDER_ID}). Throws
 * on an unknown id rather than silently falling back — a typo'd
 * `REVIEW_PROVIDER` should fail loudly, not gate PRs against the wrong bot.
 */
export function resolveProvider(id?: string | null): ReviewProvider {
  const raw =
    id === undefined || id === null || id.trim() === ""
      ? DEFAULT_PROVIDER_ID
      : id.trim().toLowerCase();
  const parsed = ProviderIdSchema.safeParse(raw);
  if (parsed.success) return PROVIDERS[parsed.data];
  throw new Error(
    `Unknown review provider '${String(id)}'. Known providers: ${ProviderIdSchema.options.join(", ")}.`,
  );
}
