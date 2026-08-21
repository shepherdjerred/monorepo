import {
  isEnabled,
  numberValue,
  stringValue,
} from "@shepherdjerred/feature-flags/index.ts";
import { isAbsent } from "@shepherdjerred/feature-flags/flag-result.ts";

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
  get: (names: FlagSourceKeyNames) => Promise<FlagSourceResult | undefined>;
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
};

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
  return {
    name: "flag",
    get: async (
      names: FlagSourceKeyNames,
    ): Promise<FlagSourceResult | undefined> => {
      const kind = options.kinds[names.key];
      if (kind === undefined) {
        return undefined;
      }

      const evaluation = {
        targetingKey: options.targetingKey,
        ...(options.attributes === undefined
          ? {}
          : { attributes: options.attributes }),
      };

      switch (kind) {
        case "boolean": {
          const result = await isEnabled(names.flag, {
            default: false,
            ...evaluation,
          });
          return isAbsent(result) ? undefined : { value: result.value };
        }
        case "string": {
          const result = await stringValue(names.flag, {
            default: "",
            ...evaluation,
          });
          return isAbsent(result) ? undefined : { value: result.value };
        }
        case "number": {
          const result = await numberValue(names.flag, {
            default: 0,
            ...evaluation,
          });
          return isAbsent(result) ? undefined : { value: result.value };
        }
      }
    },
  };
}
