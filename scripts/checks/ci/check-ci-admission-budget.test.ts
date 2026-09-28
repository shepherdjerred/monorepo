import { describe, expect, test } from "vitest";

import {
  admissionBudgetViolations,
  parseQuantity,
  type AdmissionBudget,
  type AdmissionStep,
} from "./check-ci-admission-budget.ts";

const BUDGET: AdmissionBudget = {
  maxWorkflows: 4,
  maxServicesPerWorkflow: 2,
  quota: { cpu: "8", memory: "16Gi", "ephemeral-storage": "40Gi" },
};

const TIER = {
  cpuRequest: "1",
  memoryRequest: "4Gi",
  ephemeralStorageRequest: "2Gi",
};

const SMALL = {
  cpuRequest: "250m",
  memoryRequest: "512Mi",
  ephemeralStorageRequest: "1Gi",
};

function step(overrides: Partial<AdmissionStep> = {}): AdmissionStep {
  return { key: "verify", resources: TIER, ...overrides };
}

describe("CI admission budget", () => {
  test("parses the quantities the pipeline and quota use", () => {
    expect(parseQuantity("250m")).toBe(0.25);
    expect(parseQuantity("24")).toBe(24);
    expect(parseQuantity("512Mi")).toBe(512 * 2 ** 20);
    expect(parseQuantity("80Gi")).toBe(80 * 2 ** 30);
    expect(() => parseQuantity("1.5 cores")).toThrow("unsupported");
  });

  test("accepts steps whose services can never starve a step", () => {
    const services = [
      { name: "tempo", resources: SMALL },
      { name: "minio", resources: SMALL },
    ];
    expect(
      admissionBudgetViolations(
        [step(), step({ key: "e2e", services })],
        BUDGET,
      ),
    ).toEqual([]);
  });

  /**
   * Four workflows each holding 4Gi of admitted services leave nothing for
   * a 4Gi step: the queue can deadlock with every step gated.
   */
  test("rejects services large enough to deadlock admission", () => {
    const services = [{ name: "db", resources: TIER }];
    expect(admissionBudgetViolations([step({ services })], BUDGET)).toEqual([
      expect.stringContaining("memory:"),
    ]);
  });

  test("rejects a step with more services than the pods quota was sized for", () => {
    const services = [
      { name: "a", resources: SMALL },
      { name: "b", resources: SMALL },
      { name: "c", resources: SMALL },
    ];
    expect(admissionBudgetViolations([step({ services })], BUDGET)).toEqual([
      "verify declares 3 services; the budget allows 2 per workflow",
    ]);
  });

  test("rejects a step no quota could ever admit", () => {
    const huge = { ...TIER, cpuRequest: "9" };
    expect(
      admissionBudgetViolations([step({ resources: huge })], BUDGET),
    ).toEqual([expect.stringContaining("cpu:")]);
  });

  /** macOS lanes run on the Mac with no pod: nothing for Kueue to admit. */
  test("ignores local-backend steps", () => {
    const huge = { ...TIER, memoryRequest: "1Ti" };
    expect(
      admissionBudgetViolations(
        [step(), step({ key: "mac", backend: "local", resources: huge })],
        BUDGET,
      ),
    ).toEqual([]);
  });
});
