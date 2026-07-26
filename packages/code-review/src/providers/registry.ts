import { z } from "zod";
import type { ReviewProvider } from "../types.ts";
import { codexProvider } from "./codex.ts";
import { greptileProvider } from "./greptile.ts";

/** Every registered review provider, keyed by its stable id. */
export const PROVIDERS = {
  greptile: greptileProvider,
  codex: codexProvider,
} as const;

// Keep these ids in sync with the keys of PROVIDERS above.
export const ProviderIdSchema = z.enum(["greptile", "codex"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * The active provider when `REVIEW_PROVIDER` is unset. Codex is live after the
 * Greptile → Codex cutover; change this (or set the env var) to swap.
 */
export const DEFAULT_PROVIDER_ID: ProviderId = "codex";

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
