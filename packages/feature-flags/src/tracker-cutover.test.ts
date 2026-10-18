import { expect, test } from "vitest";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
} from "./managed-flag-inventory.ts";

test("production cutover enables native writes while the global fallback stays closed", () => {
  const prod = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    "prod",
    "tracker",
  );
  expect(
    prod.find((flag) => flag.key === "tracker-writes-enabled"),
  ).toMatchObject({ default: true, rollouts: [] });
  expect(
    managedFlagInventory.flags.find(
      (flag) => flag.key === "tracker-writes-enabled",
    )?.default,
  ).toBe(false);
});
