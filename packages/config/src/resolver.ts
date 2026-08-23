import {
  prepareDefinition,
  type ConfigKeyDefinition,
  type ConfigValue,
  type ResolvedKey,
} from "@shepherdjerred/config/definition.ts";
import type { z } from "zod";
import type {
  ConfigSource,
  ConfigSourceName,
} from "@shepherdjerred/config/source.ts";

export type ResolvedValue<T> = {
  readonly value: T;
  /** Which layer supplied it. Always populated. */
  readonly source: ConfigSourceName;
};

export type ChangeEvent = {
  readonly key: string;
  readonly previous: unknown;
  readonly next: unknown;
  readonly source: ConfigSourceName;
};

export type ResolveEvent = {
  readonly key: string;
  readonly source: ConfigSourceName;
  readonly durationMs: number;
};

export type ResolverHooks = {
  /** Called for every resolution, with the layer that answered and how long it
   * took. Metering lives here rather than in the resolver so this package needs
   * no metrics client — see `observability.ts`. */
  readonly onResolve?: (event: ResolveEvent) => void;
  /** Called once per key whose resolved value differs from the last read. */
  readonly onChange?: (event: ChangeEvent) => void;
  /** Called once per key that a source failed on, before falling back. */
  readonly onSourceError?: (
    key: string,
    source: ConfigSourceName,
    message: string,
  ) => void;
};

export type ResolverOptions<D extends Record<string, ConfigKeyDefinition>> = {
  readonly definition: D;
  /**
   * Sources by layer name. A layer a key lists but that is not supplied here is
   * skipped — this is how `FEATURE_FLAGS_MODE=disabled` removes the flag layer
   * without touching any declaration.
   */
  readonly sources: Partial<Record<ConfigSourceName, ConfigSource>>;
  readonly hooks?: ResolverHooks;
  /**
   * Caps the change-detection cache. Only keys actually read are tracked, and
   * targeted keys key their entry by entity, so the bound exists to stop a
   * targeted key growing it without limit.
   */
  readonly changeCacheLimit?: number;
};

const DEFAULT_CHANGE_CACHE_LIMIT = 512;
const FATAL_SOURCE_ERROR_NAME = "ConfigSourceFatalError";

export type EvaluationOverrides = {
  /** Distinguishes cache entries for targeted keys and selects their value. */
  readonly targetingKey?: string;
};

export type DescribedKey = {
  readonly key: string;
  readonly source: ConfigSourceName;
  readonly eligible: readonly ConfigSourceName[];
  readonly sensitive: boolean;
  /** Omitted for sensitive keys; use `digest` instead. */
  readonly value?: unknown;
  /** Present for sensitive keys: a short hash, never the value. */
  readonly digest?: string;
};

export type Resolver<D extends Record<string, ConfigKeyDefinition>> = {
  get: <K extends keyof D & string>(
    key: K,
    context?: EvaluationOverrides,
  ) => Promise<ResolvedValue<ConfigValue<D[K]>>>;
  /** Value only, for call sites that do not care where it came from. */
  value: <K extends keyof D & string>(
    key: K,
    context?: EvaluationOverrides,
  ) => Promise<ConfigValue<D[K]>>;
  /** Every key with its resolved value and source, for the startup dump. */
  describe: () => Promise<readonly DescribedKey[]>;
  readonly keys: readonly (keyof D & string)[];
};

function digestOf(value: unknown): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify(value ?? null));
  return hasher.digest("hex").slice(0, 12);
}

/** What a layer produced, before the key's schema validates it. */
type RawResolution = {
  readonly raw: unknown;
  readonly source: ConfigSourceName;
  /** The default path is already the declared type; skip re-validating it. */
  readonly isDefault: boolean;
};

export function createResolver<D extends Record<string, ConfigKeyDefinition>>(
  options: ResolverOptions<D>,
): Resolver<D> {
  const prepared = new Map<string, ResolvedKey>();
  for (const [key, definition] of Object.entries(options.definition)) {
    prepared.set(key, prepareDefinition(key, definition));
  }

  // A bootstrap key (`sources: ["env"]`) simply never lists the flag layer, so
  // it cannot wait on a flag client that itself needs FLIPT_URL to exist. And a
  // key listing "flag" when no flag source is supplied is not an error — that
  // is exactly FEATURE_FLAGS_MODE=disabled, and the key falls through to its
  // remaining layers. Both fall out of the loop below; neither needs a guard.

  const lastValues = new Map<string, unknown>();
  const limit = options.changeCacheLimit ?? DEFAULT_CHANGE_CACHE_LIMIT;

  function cacheKeyFor(
    resolved: ResolvedKey,
    overrides: EvaluationOverrides | undefined,
  ): string {
    return resolved.targeted
      ? `${resolved.names.key}\u{0}${overrides?.targetingKey ?? ""}`
      : resolved.names.key;
  }

  function recordChange(
    key: string,
    cacheKey: string,
    next: unknown,
    source: ConfigSourceName,
  ): void {
    const onChange = options.hooks?.onChange;
    if (onChange === undefined) {
      return;
    }
    if (lastValues.has(cacheKey)) {
      const previous = lastValues.get(cacheKey);
      if (!Object.is(previous, next)) {
        onChange({ key, previous, next, source });
      }
    } else if (lastValues.size >= limit) {
      // Bounded: evict the oldest insertion rather than grow without limit.
      const oldest = lastValues.keys().next();
      if (oldest.done !== true) {
        lastValues.delete(oldest.value);
      }
    }
    lastValues.set(cacheKey, next);
  }

  async function resolveRaw(
    resolved: ResolvedKey,
    overrides: EvaluationOverrides | undefined,
  ): Promise<RawResolution> {
    for (const sourceName of resolved.sources) {
      if (sourceName === "default") {
        break;
      }
      const source = options.sources[sourceName];
      if (source === undefined) {
        continue;
      }

      let produced;
      try {
        produced = await source.get(resolved.names, overrides);
      } catch (error) {
        if (error instanceof Error && error.name === FATAL_SOURCE_ERROR_NAME) {
          throw error;
        }
        // A source that FAILED is not a source with no opinion. Report it and
        // continue, but never treat the failure as an answer.
        const message = error instanceof Error ? error.message : String(error);
        options.hooks?.onSourceError?.(resolved.names.key, sourceName, message);
        continue;
      }

      // `undefined` is absence — keep descending. Anything else is an ANSWER
      // and stops resolution, including `false`. This is the property the whole
      // package exists to guarantee.
      if (produced !== undefined) {
        return { raw: produced.value, source: sourceName, isDefault: false };
      }
    }
    return { raw: resolved.default, source: "default", isDefault: true };
  }

  // Generic over the SCHEMA, not its output: inference from `z.ZodType<T>`
  // yields `unknown` when the argument's type is itself generic-dependent
  // (`D[K]["schema"]`). Inferring `S` and deriving the output with `z.infer`
  // carries the value type all the way to the caller with no assertion.
  async function resolveTyped<S extends z.ZodType>(
    key: string,
    schema: S,
    overrides: EvaluationOverrides | undefined,
  ): Promise<ResolvedValue<z.infer<S>>> {
    const resolved = prepared.get(key);
    if (resolved === undefined) {
      throw new Error(`unknown config key "${key}"`);
    }

    const startedAt = Bun.nanoseconds();
    const produced = await resolveRaw(resolved, overrides);

    // Every path validates, including the default: `default` is `unknown` at
    // the type level (the schema is what types a key), so a default that does
    // not satisfy its own schema must fail loudly rather than type as the
    // wrong thing. A present-but-invalid value from a source is likewise a
    // configuration bug, not absence — falling through would mask it behind a
    // lower layer.
    const parsed = schema.safeParse(produced.raw);
    if (!parsed.success) {
      throw new Error(
        produced.isDefault
          ? `config key "${key}" has a default that does not satisfy its own schema: ${parsed.error.message}`
          : `config key "${key}" from ${produced.source} failed validation: ${parsed.error.message}`,
      );
    }
    const value: z.infer<S> = parsed.data;

    options.hooks?.onResolve?.({
      key,
      source: produced.source,
      durationMs: (Bun.nanoseconds() - startedAt) / 1_000_000,
    });
    recordChange(key, cacheKeyFor(resolved, overrides), value, produced.source);
    return { value, source: produced.source };
  }

  // Returns the key's own schema type (`D[K]["schema"]`), not the widened
  // `z.ZodType` the constraint declares — that is what carries the value type
  // through to the caller without an assertion.
  function schemaFor<K extends keyof D & string>(key: K): D[K]["schema"] {
    const definition = options.definition[key];
    if (definition === undefined) {
      throw new Error(`unknown config key "${key}"`);
    }
    return definition.schema;
  }

  return {
    // `async` so a bad key surfaces as a rejection rather than a synchronous
    // throw — callers await these, and a sync throw skips their catch.
    get: async (key, context) => resolveTyped(key, schemaFor(key), context),
    value: async (key, context) => {
      const resolvedValue = await resolveTyped(key, schemaFor(key), context);
      return resolvedValue.value;
    },
    describe: async () => {
      const described: DescribedKey[] = [];
      for (const [key, resolved] of prepared) {
        // Not metered: describe() is the startup dump, not a hot-path read, and
        // counting it would double every key's resolution total at boot.
        const produced = await resolveRaw(resolved, undefined);
        const value = resolved.schema.parse(produced.raw);
        described.push(
          resolved.sensitive
            ? {
                key,
                source: produced.source,
                eligible: resolved.sources,
                sensitive: true,
                digest: digestOf(value),
              }
            : {
                key,
                source: produced.source,
                eligible: resolved.sources,
                sensitive: false,
                value,
              },
        );
      }
      return described;
    },
    keys: [...prepared.keys()],
  };
}
