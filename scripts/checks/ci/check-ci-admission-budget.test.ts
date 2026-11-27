import { describe, expect, test } from "vitest";

import {
  admissionBudgetViolations,
  parseQuantity,
  pooledAdmissionBudgetViolations,
  type AdmissionBudget,
  type AdmissionStep,
  StepSchema,
} from "./check-ci-admission-budget.ts";
import {
  PooledAdmissionBudgetSchema as PooledBudgetSchema,
  queueWorkflows,
} from "../../lib/ci/admission-budget.ts";
import rawBudget from "../../../packages/homelab/src/cdk8s/src/misc/ci-admission-budget.json" with { type: "json" };
import {
  CHECKED_STEP_GRAPHS,
  readGeneratedStepJson,
} from "../../lib/ci/generated-steps.ts";
import { z } from "zod";

test("the admission graph includes bounded RAM scratch alongside ordinary workflows", async () => {
  const generated = z
    .array(StepSchema)
    .parse(
      await readGeneratedStepJson(
        new URL("../../../", import.meta.url).pathname,
        { includeCanaries: true },
      ),
    );
  expect(
    generated
      .filter((entry) => entry.key === "verify")
      .map((entry) => entry.resources.memoryRequest),
  ).toEqual(["20Gi", "20Gi", "20Gi"]);
  // RAM scratch raises only the limit: the request is the lane's measured
  // working set, tmpfs pages included, with or without the profile.
  expect(
    generated
      .filter((entry) => entry.key === "playwright-e2e")
      .map((entry) => entry.resources.memoryRequest),
  ).toEqual(["4Gi", "4Gi"]);
  expect(
    pooledAdmissionBudgetViolations(
      generated,
      PooledBudgetSchema.parse(rawBudget),
    ),
  ).toEqual([]);
});

test("every pipeline graph, the flag-on producers included, fits the admission budget", async () => {
  expect(CHECKED_STEP_GRAPHS).toContainEqual(["--delivery-catalog-v2"]);
  for (const graph of CHECKED_STEP_GRAPHS) {
    const generated = z
      .array(StepSchema)
      .parse(
        await readGeneratedStepJson(
          new URL("../../../", import.meta.url).pathname,
          { includeCanaries: true, graph },
        ),
      );
    const keys = new Set(generated.map((entry) => entry.key));
    const flagOn = graph.includes("--delivery-catalog-v2");
    for (const producer of ["tofu-archives", "npm-package-archives"])
      expect(keys.has(producer), `${producer} in ${graph.join(" ")}`).toBe(
        flagOn,
      );
    expect(
      pooledAdmissionBudgetViolations(
        generated,
        PooledBudgetSchema.parse(rawBudget),
      ),
    ).toEqual([]);
  }
}, 60_000);

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
      memory: "72Gi",
      "ephemeral-storage": "60Gi",
    });
  });

  test("checks the overlap rather than only the new workflow cap", () => {
    // 22 PR and main slots hold 55Gi of services beside a 4Gi step, inside
    // the 62Gi compute quota; 12 more legacy slots overflow it.
    const largeServices = step({
      services: [
        { name: "db", resources: { ...SMALL, memoryRequest: "2560Mi" } },
      ],
    });
    expect(
      pooledAdmissionBudgetViolations([largeServices], {
        ...budget,
        legacyMaxWorkflows: 0,
      }),
    ).toEqual([]);
    expect(
      pooledAdmissionBudgetViolations([largeServices], {
        ...budget,
        legacyMaxWorkflows: 12,
      }),
    ).toEqual([expect.stringContaining("memory:")]);
  });

  test("rejects budget growth and a mismatched workflow total", () => {
    expect(
      pooledAdmissionBudgetViolations([compute], {
        ...budget,
        maxWorkflows: budget.maxWorkflows + 1,
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

  /** Woodpecker holds a workflow no agent's labels match, without failing it. */
  test("rejects a workflow routed to a pool with no agent", () => {
    expect(
      pooledAdmissionBudgetViolations(
        [
          compute,
          step({ key: "orphan", agentLabels: { "ci-pool": "nightly" } }),
        ],
        budget,
      ),
    ).toEqual([
      "orphan: routed to the nightly pool, which has no agent in the budget",
    ]);
  });

  /**
   * The maintenance agent takes only maintenance workflows, so its slots hold
   * their services and never an ordinary workflow's. Both share compute quota.
   */
  describe("dedicated compute pools", () => {
    // Charged to every compute slot, 2Gi of services would overflow the
    // widened budget below; charged only to PR and main slots, it fits.
    const largeServices = step({
      services: [{ name: "db", resources: { ...SMALL, memoryRequest: "2Gi" } }],
    });
    const maintenance = step({
      key: "maintenance-workspace-golden",
      agentLabels: { "ci-pool": "maintenance" },
    });
    const widened = {
      ...budget,
      maxWorkflows: budget.maxWorkflows + 12,
      pools: {
        ...budget.pools,
        maintenance: { ...budget.pools.maintenance, maxWorkflows: 13 },
      },
    };

    test("do not hold an ordinary workflow's services", () => {
      expect(
        pooledAdmissionBudgetViolations([largeServices, maintenance], widened),
      ).toEqual([]);
    });

    test("hold their own workflows' services against compute quota", () => {
      expect(
        pooledAdmissionBudgetViolations(
          [
            largeServices,
            {
              ...maintenance,
              services: [
                { name: "db", resources: { ...SMALL, memoryRequest: "4Gi" } },
              ],
            },
          ],
          widened,
        ),
      ).toEqual([
        expect.stringContaining(
          `memory: ${queueWorkflows(widened.pools, "default").toString()} workflows'`,
        ),
      ]);
    });

    test("still fit their largest step within compute quota", () => {
      expect(
        pooledAdmissionBudgetViolations(
          [
            largeServices,
            {
              ...maintenance,
              resources: { ...TIER, memoryRequest: "71Gi" },
            },
          ],
          budget,
        ),
      ).toEqual([expect.stringContaining("memory:")]);
    });
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

/**
 * The light reserve must hold every pr-light slot's largest pod at once, so
 * Kueue never gates a light check and it waits only for one of its own
 * slots. A slot's largest pod may be its checkout rather than its step.
 */
describe("light reserve", () => {
  const budget = PooledBudgetSchema.parse(rawBudget);
  const compute = step({
    services: [
      { name: "a", resources: SMALL },
      { name: "b", resources: SMALL },
    ],
  });
  const CHECKOUT = { ...SMALL, memoryRequest: "2Gi" };
  const light = step({
    key: "trivy",
    agentLabels: { "ci-pool": "pr-light" },
    resources: SMALL,
    checkout: CHECKOUT,
  });

  test("holds every slot's checkout and step at once", () => {
    expect(pooledAdmissionBudgetViolations([compute, light], budget)).toEqual(
      [],
    );
    // Four 2Gi checkouts fill the 8Gi reserve exactly.
    expect(budget.lightQuota.memory).toBe("8Gi");
    expect(budget.pools["pr-light"].maxWorkflows).toBe(4);
  });

  test("rejects a slot whose checkout or step overflows the reserve", () => {
    expect(
      pooledAdmissionBudgetViolations(
        [
          compute,
          { ...light, checkout: { ...CHECKOUT, memoryRequest: "3Gi" } },
        ],
        budget,
      ),
    ).toEqual([expect.stringContaining("memory: all 4 pr-light slots")]);
    expect(
      pooledAdmissionBudgetViolations(
        [compute, { ...light, resources: { ...SMALL, cpuRequest: "1" } }],
        budget,
      ),
    ).toEqual([expect.stringContaining("cpu: all 4 pr-light slots")]);
  });

  test("rejects more slots than the reserve holds", () => {
    expect(
      pooledAdmissionBudgetViolations([compute, light], {
        ...budget,
        maxWorkflows: budget.maxWorkflows + 1,
        pools: {
          ...budget.pools,
          "pr-light": { ...budget.pools["pr-light"], maxWorkflows: 5 },
        },
      }),
    ).toEqual([expect.stringContaining("memory: all 5 pr-light slots")]);
  });

  test("forbids services and the local backend", () => {
    expect(
      pooledAdmissionBudgetViolations(
        [
          compute,
          { ...light, services: [{ name: "db", resources: SMALL }] },
          { ...light, key: "mac", backend: "local" },
        ],
        budget,
      ),
    ).toEqual([
      "trivy: the pr-light pool requires a Kubernetes workflow without services",
      "mac: the pr-light pool requires a Kubernetes workflow without services",
    ]);
  });

  test("is carved from the aggregate, not added to it", () => {
    expect(
      pooledAdmissionBudgetViolations([compute, light], {
        ...budget,
        lightQuota: { ...budget.lightQuota, cpu: "3" },
      }),
    ).toEqual([expect.stringContaining("cpu: compute, light and gate")]);
  });

  /** A main push runs the same workflows in the main pool, on compute. */
  test("still counts light workflows against compute quota", () => {
    expect(
      pooledAdmissionBudgetViolations(
        [
          compute,
          {
            ...light,
            resources: { ...SMALL, memoryRequest: "63Gi" },
            checkout: undefined,
          },
        ],
        { ...budget, lightQuota: { ...budget.lightQuota, memory: "8Gi" } },
      ),
    ).toEqual([
      expect.stringContaining("memory: all 4 pr-light slots"),
      expect.stringContaining("memory: 23 workflows'"),
    ]);
  });
});
