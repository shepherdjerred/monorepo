const SECRET_KEY_PATTERN =
  /^(?:authorization|x-api-key|api[_-]?key|api[_-]?token|access[_-]?key|secret(?:[_-]?(?:key|token|access[_-]?key))?|password|token)$/i;

const BEARER_PATTERN = /Bearer\s+[\w.\-+/=]+/g;

/**
 * Walk an arbitrary JSON-serializable value and redact known secret patterns.
 *
 * Two layers:
 *   1. Object keys matching `SECRET_KEY_PATTERN` (case-insensitive) have their
 *      value replaced with `[REDACTED]`.
 *   2. String values containing `Bearer <token>` substrings have the token
 *      replaced (covers Authorization headers that leak into request logs).
 *
 * Always returns a *copy* — the input is never mutated. Returns `unknown`
 * because the redacted shape may differ from the input (string fields become
 * `"[REDACTED]"`), so the type is no longer guaranteed by the walk. Discord
 * PII (usernames, channel IDs, message text) is intentionally not redacted:
 * this is a personal homelab and that data is required for debugging.
 */
export function redactSecrets(value: unknown): unknown {
  return walk(value);
}

function walk(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replaceAll(BEARER_PATTERN, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : walk(inner);
    }
    return result;
  }
  return value;
}
