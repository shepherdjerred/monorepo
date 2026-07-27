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

/**
 * Env var names whose *values* must never reach logs or S3 archives. Codex/agent
 * subprocesses deliberately inherit these, so an attacker-controlled goal or a
 * troubleshooting command (`env`, `cat auth.json`, `echo $OPENAI_API_KEY`) can
 * emit a live credential on stdout/stderr. We redact by literal value — that
 * catches the secret in any output format, not just `NAME=value`.
 */
const SECRET_ENV_NAMES = [
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "POKEMONCTL_TOKEN",
  "GH_TOKEN",
] as const;

// `NAME=value` / `NAME: value` where NAME is secret-shaped. Structural backstop
// for credentials we don't know by env-var name (matches the object-key rule
// above, applied to flat text). The name is preserved; only the value is masked.
const SECRET_ASSIGNMENT_PATTERN =
  /\b(\w*(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)\w*)(\s*[=:]\s*)\S+/gi;

/**
 * Redact secrets from a flat text body (command line, stdout, stderr) before it
 * is logged or archived. Three passes:
 *   1. Literal values of known secret env vars (only when ≥8 chars, so short/
 *      empty values can't blank out unrelated substrings).
 *   2. `NAME=value` assignments with secret-shaped names.
 *   3. `Bearer <token>` substrings.
 */
export function redactText(value: string): string {
  let out = value;
  for (const name of SECRET_ENV_NAMES) {
    const secret = Bun.env[name];
    if (secret !== undefined && secret.length >= 8) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out.replaceAll(
    SECRET_ASSIGNMENT_PATTERN,
    (_match, name: string, sep: string) => `${name}${sep}[REDACTED]`,
  );
  return out.replaceAll(BEARER_PATTERN, "Bearer [REDACTED]");
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
