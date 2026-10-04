import {
  isEnabled,
  numberValue,
  refreshFlagSnapshot,
  stringValue,
} from "@shepherdjerred/feature-flags/index.ts";
import {
  FlagNotFoundError,
  isAbsent,
  type FlagResult,
} from "@shepherdjerred/feature-flags/flag-result.ts";
import {
  ManagedBooleanFlagKeySchema,
  ManagedVariantFlagKeySchema,
} from "@shepherdjerred/feature-flags/managed-flag-keys.generated.ts";
import { z } from "zod";

/**
 * Structural mirror of `@shepherdjerred/config`'s source contract.
 *
 * Declared here rather than imported so the dependency points one way:
 * `@shepherdjerred/config` must not depend on this package, because its `file`
 * layer exists for apps distributed to people who have no Flipt, and importing
 * the flag client would ship them a WASM engine they never load.
 */
export type FlagSourceKeyNames = {
  readonly key: string;
  readonly flag: string;
};

export type FlagSourceResult = { readonly value: unknown };

export type FlagConfigSource = {
  readonly name: "flag";
  get: (
    names: FlagSourceKeyNames,
    context?: { readonly targetingKey?: string },
  ) => Promise<FlagSourceResult | undefined>;
};

export type FlagSourceOptions = {
  /**
   * Flipt's `entityId`. Required — it is the bucketing key, and a shared
   * constant would put the whole fleet in one hash slot, turning any percentage
   * rollout into 0% or 100%.
   */
  readonly targetingKey: string;
  /**
   * How to read each key. Flags are typed per key, and the resolver hands us
   * only a name, so the caller declares which accessor a key uses. Keys absent
   * from this map are never asked of the flag layer.
   */
  readonly kinds: Readonly<Record<string, "boolean" | "string" | "number">>;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  /**
   * Require one freshly fetched Flipt snapshot for this source's resolutions.
   * Concurrent keys share that check. Construct a new source for each write
   * guard; unavailable, disabled, and static providers cannot authorize writes.
   * Invalid successful snapshots remain fatal contract failures.
   */
  readonly requireFreshSnapshot?: boolean;
  /**
   * Called when the provider has no authoritative answer. Config resolution
   * still descends to its declared fallback, while consumers that advance a
   * durable cursor can pause until the provider recovers.
   */
  readonly onUnavailable?: (flag: string) => void;
};

const FATAL_SOURCE_ERROR_NAME = "ConfigSourceFatalError";
const ManagedSourceKeySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("boolean"), flag: ManagedBooleanFlagKeySchema }),
  z.object({
    kind: z.enum(["string", "number"]),
    flag: ManagedVariantFlagKeySchema,
  }),
]);

async function freshSnapshotOrContractError(): Promise<boolean> {
  try {
    return await refreshFlagSnapshot();
  } catch {
    const error = new Error("Fresh flag snapshot contract invalid");
    error.name = FATAL_SOURCE_ERROR_NAME;
    throw error;
  }
}

function valueOrAbsent<T>(
  result: FlagResult<T>,
  flag: string,
  onUnavailable: ((flag: string) => void) | undefined,
): FlagSourceResult | undefined {
  if (isAbsent(result)) {
    onUnavailable?.(flag);
    return undefined;
  }
  if (result.errorCode !== undefined) {
    const error = new Error(
      `flag "${flag}" evaluation failed with ${result.errorCode}`,
    );
    error.name = FATAL_SOURCE_ERROR_NAME;
    throw error;
  }
  return { value: result.value };
}

/**
 * Adapts the flag client into a config layer.
 *
 * The sentinel defaults below are never returned to a caller. Every accessor
 * requires a default, so one is supplied and then discarded: when the flag
 * resolves we return its value, and when it is absent we return `undefined` so
 * the resolver descends. The resolver's own declared default is the only
 * default a call site ever sees.
 */
export function createFlagConfigSource(
  options: FlagSourceOptions,
): FlagConfigSource {
  let freshSnapshot: Promise<boolean> | undefined;
  return {
    name: "flag",
    get: async (
      names: FlagSourceKeyNames,
      context?: { readonly targetingKey?: string },
    ): Promise<FlagSourceResult | undefined> => {
      const kind = options.kinds[names.key];
      if (kind === undefined) {
        return undefined;
      }

      const evaluation = {
        targetingKey: context?.targetingKey ?? options.targetingKey,
        ...(options.attributes === undefined
          ? {}
          : { attributes: options.attributes }),
      };

      try {
        const parsed = ManagedSourceKeySchema.safeParse({
          kind,
          flag: names.flag,
        });
        if (!parsed.success) {
          throw new FlagNotFoundError(
            names.flag,
            `flag "${names.flag}" is not defined for kind "${kind}" in managed-flag-inventory.json`,
          );
        }
        if (options.requireFreshSnapshot === true) {
          freshSnapshot ??= freshSnapshotOrContractError();
          if (!(await freshSnapshot)) {
            options.onUnavailable?.(names.flag);
            return undefined;
          }
        }
        switch (parsed.data.kind) {
          case "boolean": {
            const result = await isEnabled(parsed.data.flag, {
              default: false,
              ...evaluation,
            });
            return valueOrAbsent(result, names.flag, options.onUnavailable);
          }
          case "string": {
            const result = await stringValue(parsed.data.flag, {
              default: "",
              ...evaluation,
            });
            return valueOrAbsent(result, names.flag, options.onUnavailable);
          }
          case "number": {
            const result = await numberValue(parsed.data.flag, {
              default: 0,
              ...evaluation,
            });
            return valueOrAbsent(result, names.flag, options.onUnavailable);
          }
        }
      } catch (error) {
        if (error instanceof FlagNotFoundError) {
          const fatal = new Error(
            `flag "${names.flag}" evaluation failed: ${error.message}`,
          );
          fatal.name = FATAL_SOURCE_ERROR_NAME;
          throw fatal;
        }
        throw error;
      }
    },
  };
}
