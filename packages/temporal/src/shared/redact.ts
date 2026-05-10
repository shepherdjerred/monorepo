/**
 * Replace every occurrence of every secret in `tokens` with `***`.
 *
 * Tokens shorter than 8 chars are skipped — they generate too many false
 * positives in URLs, log fragments, and plain English. Empty / undefined
 * entries are also skipped, so callers can pass `Bun.env["FOO"]` directly
 * without null-checking.
 *
 * Used by every `claude -p` activity wrapper to scrub stderr (which can
 * contain headers like `Authorization: Bearer <token>`) before it lands
 * in Loki.
 */
export function redactSecrets(
  text: string,
  tokens: readonly (string | undefined)[],
): string {
  let result = text;
  for (const token of tokens) {
    if (token === undefined || token.length < 8) continue;
    result = result.replaceAll(token, "***");
  }
  return result;
}
