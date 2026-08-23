import type { z } from "zod";
import {
  ConfigSourceNameSchema,
  deriveKeyNames,
  type ConfigKeyNameOverrides,
  type ConfigKeyNames,
  type ConfigSourceName,
} from "@shepherdjerred/config/source.ts";

/**
 * One configuration key: its schema, which layers may supply it, and its
 * default.
 *
 * The schema — not a separate type parameter — determines the key's value type.
 * A container generic like `ConfigKeyDefinition<T>` would have to be
 * constrained to something, and every candidate (`never`, `unknown`, `any`)
 * either collapses every key to one type or requires the banned `any`.
 * Inferring from `schema` keeps each key precisely typed with no assertion.
 *
 * `default` is therefore `unknown` at the type level and validated against the
 * key's own schema at resolution time, so a default that does not satisfy its
 * schema fails loudly rather than silently typing as the wrong thing.
 */
export type ConfigKeyDefinition = {
  readonly schema: z.ZodType;
  /**
   * Layers that may supply this key, in precedence order.
   *
   * This is what makes the repo's configuration policy machine-checkable
   * instead of prose. `["env"]` is an assertion that a key is BOOTSTRAP —
   * needed to construct the thing that reads flags, so it cannot come from a
   * flag. Anything else is a key that can migrate.
   */
  readonly sources: readonly ConfigSourceName[];
  /** Used when no source answers. Must be current production behavior. */
  readonly default: unknown;
  /** Overrides the derived per-layer names. */
  readonly names?: ConfigKeyNameOverrides;
  /**
   * Redacts the value from the startup dump, printing its source and a hash
   * instead. Without this a credential resolved through the resolver lands in
   * stdout and then in Loki.
   */
  readonly sensitive?: boolean;
  /**
   * Suppresses change-detection logging for keys evaluated with a targeting
   * context. A per-guild flag legitimately returns different values for
   * different guilds; logging each alternation as a "change" is pure noise.
   */
  readonly targeted?: boolean;
};

/** The value type a key resolves to, taken from its schema. */
export type ConfigValue<T extends ConfigKeyDefinition> = z.infer<T["schema"]>;

export type ResolvedKey = {
  readonly names: ConfigKeyNames;
  readonly schema: z.ZodType;
  readonly sources: readonly ConfigSourceName[];
  readonly default: unknown;
  readonly sensitive: boolean;
  readonly targeted: boolean;
};

/**
 * Validates a declaration and resolves each key's per-layer names.
 *
 * Rejects an empty `sources` list — a key no layer may supply is always its
 * default, which is a silently dead knob rather than configuration.
 */
export function prepareDefinition(
  key: string,
  definition: ConfigKeyDefinition,
): ResolvedKey {
  if (definition.sources.length === 0) {
    throw new Error(
      `config key "${key}" declares no sources. A key nothing can supply is always its default; remove it or give it at least one source.`,
    );
  }
  for (const source of definition.sources) {
    ConfigSourceNameSchema.parse(source);
  }
  if (new Set(definition.sources).size !== definition.sources.length) {
    throw new Error(
      `config key "${key}" lists a source more than once; precedence would be ambiguous.`,
    );
  }
  return {
    names: deriveKeyNames(key, definition.names),
    schema: definition.schema,
    sources: definition.sources,
    default: definition.default,
    sensitive: definition.sensitive ?? false,
    targeted: definition.targeted ?? false,
  };
}
