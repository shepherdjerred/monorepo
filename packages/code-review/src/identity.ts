/**
 * Provider author identity. GitHub reports the SAME app identity with two
 * logins depending on the API surface: GraphQL `Bot.login` is the bare slug
 * (`greptile-apps`, `chatgpt-codex-connector`), while REST `user.login`
 * appends `[bot]`. Strip that suffix, then compare for an EXACT
 * (case-insensitive) match against the provider's known logins. A substring
 * match would let any attacker-controlled login that merely *contains*
 * `chatgpt-codex-connector` (e.g. `chatgpt-codex-connector-evil`) impersonate
 * the provider and satisfy the blocking review gate, so the comparison must be
 * exact.
 */

import type { ReviewProvider } from "./types.ts";

/** Strip a trailing `[bot]` so GraphQL and REST logins compare equal. */
export function normalizeLogin(login: string | null): string | null {
  if (login === null) return null;
  return login.endsWith("[bot]") ? login.slice(0, -"[bot]".length) : login;
}

/** True when `login` belongs to `provider` (exact, case-insensitive match). */
export function isProviderAuthor(
  provider: ReviewProvider,
  login: string | null | undefined,
): boolean {
  const normalized = normalizeLogin(login ?? null);
  if (normalized === null) return false;
  const lower = normalized.toLowerCase();
  return provider.authorLogins.some((token) => lower === token.toLowerCase());
}
