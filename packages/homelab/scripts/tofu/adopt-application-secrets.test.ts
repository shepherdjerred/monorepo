import { expect, test, vi } from "vitest";
import {
  assertAdoptionPlan,
  adoptApplicationSecrets,
} from "./adopt-application-secrets.ts";

const value = "synthetic-existing-value-never-report";
const address = 'random_password.credentials["service"]';
function plan(actions = ["no-op"], result = value) {
  return {
    resource_changes: [{ address, change: { actions } }],
    planned_values: {
      root_module: {
        resources: [{ address, type: "random_password", values: { result } }],
      },
    },
  };
}
test("adoption accepts exact existing values and refuses mutations or a different result", () => {
  expect(() => assertAdoptionPlan(plan(), { service: value })).not.toThrow();
  for (const actions of [
    ["create"],
    ["delete", "create"],
    ["delete"],
    ["update"],
  ])
    expect(() => assertAdoptionPlan(plan(actions), { service: value })).toThrow(
      "no creates",
    );
  expect(() =>
    assertAdoptionPlan(plan(["no-op"], "different"), { service: value }),
  ).toThrow("exact existing");
  expect(() => assertAdoptionPlan(plan(), {})).toThrow("exact existing");
});
test("missing, duplicate, nested or malformed resources fail without private diagnostics", () => {
  const missing = plan();
  missing.planned_values.root_module.resources = [];
  const duplicate = plan();
  duplicate.planned_values.root_module.resources.push(
    ...duplicate.planned_values.root_module.resources,
  );
  const nested = {
    ...plan(),
    planned_values: {
      root_module: {
        ...plan().planned_values.root_module,
        child_modules: [{}],
      },
    },
  };
  for (const raw of [missing, duplicate, nested, { private: value }]) {
    let message = "";
    try {
      assertAdoptionPlan(raw, { service: value });
    } catch (error) {
      message = String(error);
    }
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toContain(value);
  }
});
test("adoption refuses an unpinned source before accessing vaults", async () => {
  await expect(
    adoptApplicationSecrets(["application-secrets", "adopt", "not-a-revision"]),
  ).rejects.toThrow(/operator-only|exact current source/u);
});

test("CI cannot enter the operator adoption path", async () => {
  vi.stubEnv("CI", "true");
  try {
    await expect(
      adoptApplicationSecrets(["application-secrets", "adopt", "0".repeat(40)]),
    ).rejects.toThrow("operator-only");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("unsupported adoption arguments fail before accessing vaults", async () => {
  await expect(
    adoptApplicationSecrets([
      "application-secrets",
      "adopt",
      "0".repeat(40),
      "--dry-run",
    ]),
  ).rejects.toThrow("Usage:");
});
