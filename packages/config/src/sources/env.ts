import type {
  ConfigKeyNames,
  ConfigSource,
  SourceResult,
} from "@shepherdjerred/config/source.ts";

export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Reads from an environment map.
 *
 * An empty string is treated as **absent**, not as an answer. Kubernetes and
 * shell wrappers routinely materialise unset variables as `""`, and treating
 * that as a deliberate empty value would let an accidental blank shadow a
 * lower layer.
 */
export function createEnvSource(environment: Environment): ConfigSource {
  return {
    name: "env",
    get: (names: ConfigKeyNames): Promise<SourceResult | undefined> => {
      const raw = environment[names.env];
      if (raw === undefined || raw.length === 0) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ value: raw });
    },
  };
}
