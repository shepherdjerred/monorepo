import { expect, test } from "vitest";
import {
  managedFlagInventory,
  materializeManagedNamespaceEnvironment,
} from "./managed-flag-inventory.ts";

test("production cutover enables native writes while imports and the global fallback stay closed", () => {
  const prod = materializeManagedNamespaceEnvironment(
    managedFlagInventory,
    "prod",
    "tracker",
  );
  expect(
    prod.find((flag) => flag.key === "tracker-writes-enabled"),
  ).toMatchObject({ default: true, rollouts: [] });
  expect(
    prod.find((flag) => flag.key === "tracker-imports-enabled")?.default,
  ).toBe(false);
  expect(
    managedFlagInventory.flags.find(
      (flag) => flag.key === "tracker-writes-enabled",
    )?.default,
  ).toBe(false);
});
