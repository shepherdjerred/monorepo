import inventory from "@shepherdjerred/feature-flags/managed-flag-inventory.json" with { type: "json" };

export type ManagedFlagType = "boolean" | "variant";

export type ManagedFlagRollout = {
  readonly segmentKey: string;
  readonly property: string;
  readonly value: string;
  readonly result: boolean;
};

const managedFlagInventory = inventory;
export { managedFlagInventory };

export const managedFlagNames = managedFlagInventory.flags.map(
  (flag) => flag.key,
);
