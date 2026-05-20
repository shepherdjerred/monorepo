const SECRET_KEY_PATTERN =
  /^(authorization|x-api-key|api[_-]?key|api[_-]?token|apikey|access[_-]?key|secret([_-]?(key|token|access[_-]?key))?|password|token)$/i;

const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._\-+/=]+/g;

/**
 * Walk an arbitrary JSON-serializable value and redact known secret patterns.
 *
 * Two layers:
 *   1. Object keys matching `SECRET_KEY_PATTERN` (case-insensitive) have their
 *      value replaced with `[REDACTED]`.
 *   2. String values containing `Bearer <token>` substrings have the token
 *      replaced (covers Authorization headers that leak into request logs).
 *
 * Always returns a *copy* — the input is never mutated. Discord PII (usernames,
 * channel IDs, message text) is intentionally not redacted: this is a personal
 * homelab and that data is required for debugging.
 */
export function redactSecrets<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(BEARER_PATTERN, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = walk(inner);
      }
    }
    return result;
  }
  return value;
}
