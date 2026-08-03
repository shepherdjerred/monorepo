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
export function redactSecrets(
  value: unknown,
  additionalSecretValues: readonly string[] = [],
): unknown {
  return walk(value, additionalSecretValues);
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

// Secret-shaped field-name fragment, reused by the assignment patterns below.
const SECRET_NAME = String.raw`\w*(?:API[_-]?KEY|ACCESS[_-]?KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL)\w*`;

// Unquoted `NAME=value` / `NAME: value` where NAME is secret-shaped (e.g. `env`
// output). Structural backstop for credentials we don't know by env-var name.
// The name is preserved; only the value is masked.
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  String.raw`\b(${SECRET_NAME})(\s*[=:]\s*)\S+`,
  "gi",
);

// Quoted JSON field `"name": "value"` where the name is secret-shaped — e.g.
// `cat auth.json` printing `"access_token":"…"` / `"refresh_token":"…"`. The
// quote between name and colon dodges the unquoted pattern, and these OAuth
// tokens aren't in the env, so neither of the other passes catches them.
const SECRET_JSON_PATTERN = new RegExp(
  String.raw`("${SECRET_NAME}"\s*:\s*)"(?:[^"\\]|\\.)*"`,
  "gi",
);

/**
 * Redact secrets from a flat text body (command line, stdout, stderr) before it
 * is logged or archived. Four passes:
 *   1. Literal values of known secret env vars (only when ≥8 chars, so short/
 *      empty values can't blank out unrelated substrings).
 *   2. Unquoted `NAME=value` assignments with secret-shaped names.
 *   3. Quoted JSON `"name": "value"` fields with secret-shaped names.
 *   4. `Bearer <token>` substrings.
 */
export function redactText(
  value: string,
  additionalSecretValues: readonly string[] = [],
): string {
  let out = value;
  const configuredSecrets = SECRET_ENV_NAMES.map((name) => Bun.env[name]);
  for (const secret of [...configuredSecrets, ...additionalSecretValues]) {
    if (secret !== undefined && secret.length >= 8) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  out = out.replaceAll(
    SECRET_ASSIGNMENT_PATTERN,
    (_match, name: string, sep: string) => `${name}${sep}[REDACTED]`,
  );
  out = out.replaceAll(
    SECRET_JSON_PATTERN,
    (_match, prefix: string) => `${prefix}"[REDACTED]"`,
  );
  return out.replaceAll(BEARER_PATTERN, "Bearer [REDACTED]");
}

function walk(
  value: unknown,
  additionalSecretValues: readonly string[],
): unknown {
  if (typeof value === "string") {
    return redactText(value, additionalSecretValues);
  }
  if (Array.isArray(value)) {
    return value.map((item) => walk(item, additionalSecretValues));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = SECRET_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : walk(inner, additionalSecretValues);
    }
    return result;
  }
  return value;
}
