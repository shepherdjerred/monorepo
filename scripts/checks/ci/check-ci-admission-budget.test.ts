import { describe, expect, test } from "vitest";

import {
  admissionBudgetViolations,
  parseQuantity,
  pooledAdmissionBudgetViolations,
  type AdmissionBudget,
  type AdmissionStep,
} from "./check-ci-admission-budget.ts";
import { PooledAdmissionBudgetSchema as PooledBudgetSchema } from "../../lib/ci/admission-budget.ts";
import rawBudget from "../../../packages/homelab/src/cdk8s/src/misc/ci-admission-budget.json" with { type: "json" };

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

  test("respects a literal shared concurrency cap on expensive services", () => {
    const heavy = step({
      key: "heavy",
      services: [{ name: "db", resources: TIER }],
      concurrency: { limit: 1, group: "heavy" },
    });
    expect(admissionBudgetViolations([step(), heavy], BUDGET)).toEqual([]);
    expect(
      admissionBudgetViolations(
        [
          step(),
          {
            ...heavy,
            concurrency: { limit: 1, group: "heavy-${CI_COMMIT_SHA}" },
          },
        ],
        BUDGET,
      ),
    ).toEqual([expect.stringContaining("memory:")]);
  });

  test("shared groups use the largest resource cost and largest declared limit", () => {
    const heavy = step({
      key: "heavy",
      services: [{ name: "db", resources: TIER }],
      concurrency: { limit: 1, group: "shared" },
    });
    const other = step({
      key: "other",
      services: [{ name: "db", resources: SMALL }],
      concurrency: { limit: 4, group: "shared" },
    });
    expect(admissionBudgetViolations([heavy, other], BUDGET)).toEqual([
      expect.stringContaining("memory:"),
    ]);
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

describe("pooled CI admission budget", () => {
  const budget = PooledBudgetSchema.parse(rawBudget);
  test("shares strict queue and quantity validation with infrastructure", () => {
    expect(() =>
      PooledBudgetSchema.parse({
        ...budget,
        quota: { ...budget.quota, cpu: "" },
      }),
    ).toThrow();
    expect(() =>
      PooledBudgetSchema.parse({
        ...budget,
        pools: {
          ...budget.pools,
          review: { ...budget.pools.review, queue: "default" },
        },
      }),
    ).toThrow();
    expect(() =>
      PooledBudgetSchema.parse({ ...budget, unrecognized: true }),
    ).toThrow();
  });
  const gate = step({
    key: "ci-complete",
    skipClone: true,
    agentLabels: { "ci-pool": "completion" },
    resources: SMALL,
  });
  const compute = step({
    services: [
      { name: "a", resources: SMALL },
      { name: "b", resources: SMALL },
    ],
  });

  test("keeps scalar quotas fixed while legacy and new agents overlap", () => {
    expect(pooledAdmissionBudgetViolations([compute, gate], budget)).toEqual(
      [],
    );
    expect(budget.quota).toEqual({
      cpu: "24",
      memory: "80Gi",
      "ephemeral-storage": "60Gi",
    });
  });

  test("checks the overlap rather than only the new workflow cap", () => {
    const largeServices = step({
      services: [{ name: "db", resources: { ...SMALL, memoryRequest: "4Gi" } }],
    });
    expect(
      pooledAdmissionBudgetViolations([largeServices], {
        ...budget,
        legacyMaxWorkflows: 0,
      }),
    ).toEqual([]);
    expect(pooledAdmissionBudgetViolations([largeServices], budget)).toEqual([
      expect.stringContaining("memory:"),
    ]);
  });

  test("rejects budget growth and a mismatched workflow total", () => {
    expect(
      pooledAdmissionBudgetViolations([compute], {
        ...budget,
        maxWorkflows: 13,
        gateQuota: { ...budget.gateQuota, cpu: "2" },
      }),
    ).toEqual([
      expect.stringContaining("workflow caps"),
      expect.stringContaining("aggregate budget"),
    ]);
  });

  test("requires all gates to fit and forbids clones and services", () => {
    expect(
      pooledAdmissionBudgetViolations(
        [
          compute,
          {
            ...gate,
            resources: TIER,
            skipClone: false,
            services: [{ name: "db", resources: SMALL }],
          },
        ],
        budget,
      ),
    ).toEqual([
      expect.stringContaining("checkout-free"),
      expect.stringContaining("cpu reserve"),
      expect.stringContaining("memory reserve"),
      expect.stringContaining("ephemeral-storage reserve"),
    ]);
  });

  test("keeps draft admission below ready PRs and main", () => {
    expect(
      pooledAdmissionBudgetViolations([compute], {
        ...budget,
        priorities: { main: 300, ready: 100, draft: 200 },
      }),
    ).toEqual([expect.stringContaining("priority")]);
  });
});
