import type { FlagValue } from "./evaluate.ts";
import { validateVariantValue } from "./flag-value-schemas.ts";
import { managedFlagInventory } from "./managed-flag-inventory.ts";
import { ManagedVariantFlagKeySchema } from "./managed-flag-keys.generated.ts";

/** One reason a flag value cannot be stored. `path` is a JSON Pointer into a variant's decoded value. */
export type FlagValueKeyIssue = {
  readonly key: string;
  readonly path: string;
  readonly message: string;
};

const declaredTypes: ReadonlyMap<string, "boolean" | "variant"> = new Map(
  managedFlagInventory.flags.map((flag) => [flag.key, flag.type]),
);

/** Issues for a variant flag's stored string; empty when it decodes. */
export function variantValueIssues(
  key: string,
  raw: string,
): FlagValueKeyIssue[] {
  const variantKey = ManagedVariantFlagKeySchema.safeParse(key);
  if (!variantKey.success) {
    return [
      {
        key,
        path: "",
        message: "flag is not a managed variant flag",
      },
    ];
  }
  const validation = validateVariantValue(variantKey.data, raw);
  return validation.ok
    ? []
    : validation.issues.map((issue) => ({ key, ...issue }));
}

/**
 * Why a batch of flags must not be written: keys absent from
 * `managed-flag-inventory.json`, a type other than the declared one, or a
 * variant value that fails its registered value schema. Empty means valid.
 */
export function managedFlagWriteIssues(
  flags: readonly FlagValue[],
): FlagValueKeyIssue[] {
  return flags.flatMap((flag): FlagValueKeyIssue[] => {
    const declared = declaredTypes.get(flag.key);
    if (declared === undefined) {
      return [
        {
          key: flag.key,
          path: "",
          message: "flag is not declared in managed-flag-inventory.json",
        },
      ];
    }
    if (declared !== flag.type) {
      return [
        {
          key: flag.key,
          path: "",
          message: `flag is declared as ${declared}, got ${flag.type}`,
        },
      ];
    }
    return flag.type === "variant"
      ? variantValueIssues(flag.key, flag.value)
      : [];
  });
}
