import { z } from "zod";

/**
 * The layer a value came from. Returned with every read, because the known
 * failure of layered config systems is "I set the env var and nothing
 * happened" — without provenance you trade one clear layer for four opaque
 * ones.
 */
export const ConfigSourceNameSchema = z.enum([
  "flag",
  "env",
  "file",
  "default",
]);

export type ConfigSourceName = z.infer<typeof ConfigSourceNameSchema>;

/**
 * What a source returns for a key.
 *
 * `undefined` means **absent** — this source has no opinion, so resolution
 * continues to the next layer. Anything else means the source **answered**, and
 * resolution stops there even when the value is `false`.
 *
 * That distinction is the entire correctness property of this package. A flag
 * deliberately turned off must stop the waterfall; if it fell through, an env
 * var still set to `true` would silently re-enable exactly what an operator
 * just disabled.
 */
export type SourceResult = {
  /** The raw value, before per-key schema validation. */
  readonly value: unknown;
};

export type ConfigSource = {
  readonly name: ConfigSourceName;
  /**
   * Resolve a key, or return `undefined` when this source does not define it.
   *
   * Implementations must NOT translate their own errors into `undefined`: a
   * source that failed is not a source that has no opinion, and conflating them
   * hands control to a lower layer on what is really a fault.
   */
  get: (key: ConfigKeyNames) => Promise<SourceResult | undefined>;
};

/**
 * The names one key answers to in each layer.
 *
 * Derived by convention from the declaration key so a typical entry needs no
 * naming boilerplate, with per-key overrides because the audit found existing
 * env var names are not consistent enough to derive reliably in every case.
 */
export type ConfigKeyNames = {
  /** The camelCase key as declared. */
  readonly key: string;
  /** Flipt flag key. Convention: kebab-case. */
  readonly flag: string;
  /** Environment variable. Convention: SCREAMING_SNAKE_CASE. */
  readonly env: string;
  /** Dotted path into the config file. Convention: dot.separated.path. */
  readonly file: string;
};

function toKebabCase(key: string): string {
  return key.replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function toScreamingSnakeCase(key: string): string {
  return key.replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function toDottedPath(key: string): string {
  return key.replaceAll(/([a-z0-9])([A-Z])/g, "$1.$2").toLowerCase();
}

export type ConfigKeyNameOverrides = {
  readonly flag?: string;
  readonly env?: string;
  readonly file?: string;
};

export function deriveKeyNames(
  key: string,
  overrides: ConfigKeyNameOverrides = {},
): ConfigKeyNames {
  return {
    key,
    flag: overrides.flag ?? toKebabCase(key),
    env: overrides.env ?? toScreamingSnakeCase(key),
    file: overrides.file ?? toDottedPath(key),
  };
}
