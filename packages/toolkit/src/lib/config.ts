/**
 * Environment-variable helpers for toolkit service clients.
 *
 * `requireEnv` throws an actionable error naming the missing variable and what
 * it configures; `optionalEnv` returns `undefined` when unset. Both read from
 * `Bun.env` and treat an empty string as absent.
 */

/**
 * Read a required environment variable. Throws a friendly, actionable error
 * naming the variable and its purpose when it is unset or empty.
 *
 * @param name - The environment variable name, e.g. `"GRAFANA_URL"`.
 * @param description - What the variable configures, used in the error message.
 */
export function requireEnv(name: string, description: string): string {
  const value = Bun.env[name];
  if (value == null || value.length === 0) {
    throw new Error(
      `${name} environment variable is not set (${description}). Set ${name} in your environment and try again.`,
    );
  }
  return value;
}

/**
 * Read an optional environment variable. Returns `undefined` when the variable
 * is unset or empty.
 */
export function optionalEnv(name: string): string | undefined {
  const value = Bun.env[name];
  if (value == null || value.length === 0) {
    return undefined;
  }
  return value;
}
