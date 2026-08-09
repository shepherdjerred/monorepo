import { z } from "zod";
import type { ReviewProvider } from "../types.ts";
import { qodoProvider } from "./qodo.ts";

/** Every registered review provider, keyed by its stable id. */
export const PROVIDERS = {
  qodo: qodoProvider,
} as const;

// Keep these ids in sync with the keys of PROVIDERS above.
export const ProviderIdSchema = z.enum(["qodo"]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * The active provider when `REVIEW_PROVIDER` is unset. Qodo is the only active
 * provider; the older provider modules remain exported for dormant consumers
 * such as the PR-fleet fixtures, but cannot be selected by the CI gate.
 */
export const DEFAULT_PROVIDER_ID: ProviderId = "qodo";

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
