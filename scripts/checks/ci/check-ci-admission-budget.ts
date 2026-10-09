#!/usr/bin/env bun

/**
 * Prove the generated CI pipeline fits the CI admission budget.
 *
 * Kueue admits each CI pod separately, and a workflow's services are admitted
 * before its step. So a budget that fits every step on its own can still
 * deadlock: if every in-flight workflow has its services admitted and waiting,
 * and what is left cannot hold any step, nothing ever finishes to free quota.
 * The budget lives in cdk8s and the resources in the pipeline generator,
 * neither of which can see the other, so this check reads both:
 *
 * - `packages/homelab/src/cdk8s/src/misc/ci-admission-budget.json`, from which
 *   cdk8s builds the Kueue ClusterQueue and the agent's workflow cap;
 * - the generator's step model, from `dump-steps.ts`.
 */

import path from "node:path";
import { z } from "zod";
import { readGeneratedStepJson } from "../../lib/ci/generated-steps.ts";

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
const BUDGET_PATH = path.join(
  REPO_ROOT,
  "packages/homelab/src/cdk8s/src/misc/ci-admission-budget.json",
);

/** The resources Kueue meters in quantities; `pods` is checked as a count. */
const METERED = ["cpu", "memory", "ephemeral-storage"] as const;
type Metered = (typeof METERED)[number];

const TierSchema = z.object({
  cpuRequest: z.string(),
  memoryRequest: z.string(),
  ephemeralStorageRequest: z.string(),
});

const StepSchema = z.object({
  key: z.string(),
  backend: z.string().optional(),
  agentLabels: z.record(z.string(), z.string()).optional(),
  skipClone: z.boolean().optional(),
  concurrency: z
    .object({
      limit: z.number().int().positive(),
      group: z.string().optional(),
    })
    .optional(),
  resources: TierSchema,
  services: z
    .array(z.object({ name: z.string(), resources: TierSchema }))
    .optional(),
});

export type AdmissionStep = z.infer<typeof StepSchema>;

const BudgetSchema = z.object({
  maxWorkflows: z.number().int().positive(),
  maxServicesPerWorkflow: z.number().int().nonnegative(),
  quota: z.object({
    cpu: z.string(),
    memory: z.string(),
    "ephemeral-storage": z.string(),
  }),
});

export type AdmissionBudget = z.infer<typeof BudgetSchema>;

const PoolSchema = (queue: "default" | "ci-gates") =>
  z
    .object({
      maxWorkflows: z.number().int().positive(),
      queue: z.literal(queue),
    })
    .strict();

export const PooledBudgetSchema = BudgetSchema.extend({
  $comment: z.string(),
  legacyMaxWorkflows: z.number().int().nonnegative(),
  computeQuota: BudgetSchema.shape.quota,
  gateQuota: BudgetSchema.shape.quota,
  pools: z
    .object({
      pr: PoolSchema("default"),
      main: PoolSchema("default"),
      review: PoolSchema("ci-gates"),
      completion: PoolSchema("ci-gates"),
    })
    .strict(),
  priorities: z
    .object({
      main: z.number().int(),
      ready: z.number().int(),
      draft: z.number().int(),
    })
    .strict(),
}).strict();

export type PooledAdmissionBudget = z.infer<typeof PooledBudgetSchema>;

const SUFFIXES: Readonly<Record<string, number>> = {
  m: 1e-3,
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
};

/** A Kubernetes resource quantity, as a plain number of base units. */
export function parseQuantity(quantity: string): number {
  const match = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/u.exec(quantity);
  const multiplier = match?.[2] === undefined ? undefined : SUFFIXES[match[2]];
  if (multiplier === undefined || match?.[1] === undefined) {
    throw new Error(`unsupported resource quantity: ${quantity}`);
  }
  return Number(match[1]) * multiplier;
}

function request(tier: z.infer<typeof TierSchema>, resource: Metered): number {
  switch (resource) {
    case "cpu": {
      return parseQuantity(tier.cpuRequest);
    }
    case "memory": {
      return parseQuantity(tier.memoryRequest);
    }
    case "ephemeral-storage": {
      return parseQuantity(tier.ephemeralStorageRequest);
    }
  }
}

/** Upper bound for held services, respecting literal repository-wide groups. */
function heldServices(
  steps: readonly AdmissionStep[],
  slots: number,
  resource: Metered,
): number {
  const groups = new Map<string, { cost: number; capacity: number }>();
  let unbounded = 0;
  for (const step of steps) {
    const cost = (step.services ?? []).reduce(
      (sum, service) => sum + request(service.resources, resource),
      0,
    );
    const group = step.concurrency?.group;
    // A substituted group may differ for each pipeline; it is not a shared
    // capacity guarantee. Conflicting limits use the larger, conservative cap.
    if (
      group === undefined ||
      step.concurrency === undefined ||
      !/^[a-z][a-z0-9-]*$/u.test(group)
    ) {
      unbounded = Math.max(unbounded, cost);
    } else {
      const previous = groups.get(group);
      groups.set(group, {
        cost: Math.max(previous?.cost ?? 0, cost),
        capacity: Math.max(previous?.capacity ?? 0, step.concurrency.limit),
      });
    }
  }
  const choices = [
    ...groups.values(),
    { cost: unbounded, capacity: slots },
  ].toSorted((a, b) => b.cost - a.cost);
  let remaining = slots;
  let total = 0;
  for (const choice of choices) {
    const count = Math.min(remaining, choice.capacity);
    total += count * choice.cost;
    remaining -= count;
  }
  return total;
}

export function admissionBudgetViolations(
  steps: readonly AdmissionStep[],
  budget: AdmissionBudget,
): string[] {
  const violations: string[] = [];
  // macOS lanes run on the Mac's local backend: no pod, nothing to admit.
  const podSteps = steps.filter((step) => step.backend !== "local");
  if (podSteps.length === 0) {
    return ["the step model has no Kubernetes steps; is the dump empty?"];
  }

  for (const step of podSteps) {
    const services = step.services ?? [];
    if (services.length > budget.maxServicesPerWorkflow) {
      violations.push(
        `${step.key} declares ${services.length.toString()} services; the budget allows ${budget.maxServicesPerWorkflow.toString()} per workflow`,
      );
    }
  }

  for (const resource of METERED) {
    const quota = parseQuantity(budget.quota[resource]);
    const largestStep = Math.max(
      ...podSteps.map((step) => request(step.resources, resource)),
    );
    const services = heldServices(podSteps, budget.maxWorkflows, resource);
    // Every in-flight workflow holding its services, while one more step
    // still needs admitting.
    const worstCase = services + largestStep;
    if (worstCase > quota) {
      violations.push(
        `${resource}: ${budget.maxWorkflows.toString()} workflows' held services (${String(services)}) plus the largest step (${String(largestStep)}) need ${String(worstCase)}, over the ${budget.quota[resource]} quota; admitted services could starve every step`,
      );
    }
  }
  return violations;
}

/** Prove both the steady pools and their bounded overlap with the old agent. */
export function pooledAdmissionBudgetViolations(
  steps: readonly AdmissionStep[],
  budget: PooledAdmissionBudget,
): string[] {
  const { pools } = budget;
  const violations: string[] = [];
  const steadyWorkflows = Object.values(pools).reduce(
    (sum, pool) => sum + pool.maxWorkflows,
    0,
  );
  if (steadyWorkflows !== budget.maxWorkflows) {
    violations.push("the pool workflow caps must sum to maxWorkflows");
  }
  if (!(
    budget.priorities.main > budget.priorities.ready &&
    budget.priorities.ready > budget.priorities.draft
  )) {
    violations.push(
      "admission priority must order main above ready PRs above drafts",
    );
  }
  for (const resource of METERED) {
    if (
      parseQuantity(budget.computeQuota[resource]) +
        parseQuantity(budget.gateQuota[resource]) !==
      parseQuantity(budget.quota[resource])
    ) {
      violations.push(
        `${resource}: compute and gate quotas must sum to the existing aggregate budget`,
      );
    }
  }

  const gateSteps = steps.filter((step) =>
    ["review", "completion"].includes(step.agentLabels?.["ci-pool"] ?? ""),
  );
  const computeSteps = steps.filter((step) => !gateSteps.includes(step));
  // Before routing activates, the old agent may still hold configurations
  // without today's concurrency groups. It must fit the reduced compute
  // quota on its own. Activation additionally requires those configurations
  // to have drained; the overlap proof below uses the deployed group caps.
  if (budget.legacyMaxWorkflows > 0) {
    violations.push(
      ...admissionBudgetViolations(
        computeSteps.map(({ concurrency: _concurrency, ...step }) => step),
        {
          maxWorkflows: budget.legacyMaxWorkflows,
          maxServicesPerWorkflow: budget.maxServicesPerWorkflow,
          quota: budget.computeQuota,
        },
      ).map((violation) => `before routing: ${violation}`),
    );
  }
  // Old configurations still select the legacy agent. They retain their
  // services while the newly routed compute workflows start, so include both
  // caps until that agent is drained and removed from the source.
  violations.push(
    ...admissionBudgetViolations(computeSteps, {
      maxWorkflows:
        budget.legacyMaxWorkflows +
        pools.pr.maxWorkflows +
        pools.main.maxWorkflows,
      maxServicesPerWorkflow: budget.maxServicesPerWorkflow,
      quota: budget.computeQuota,
    }),
  );

  const gateWorkflows =
    pools.review.maxWorkflows + pools.completion.maxWorkflows;
  for (const step of gateSteps) {
    if (
      step.backend === "local" ||
      step.skipClone !== true ||
      (step.services?.length ?? 0) !== 0
    ) {
      violations.push(
        `${step.key}: gate pools require a checkout-free Kubernetes workflow without services`,
      );
    }
    for (const resource of METERED) {
      if (
        gateWorkflows * request(step.resources, resource) >
        parseQuantity(budget.gateQuota[resource])
      ) {
        violations.push(
          `${step.key}: all ${gateWorkflows.toString()} gate slots must fit simultaneously in the ${resource} reserve`,
        );
      }
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const budget = PooledBudgetSchema.parse(await Bun.file(BUDGET_PATH).json());
  const steps = z
    .array(StepSchema)
    .parse(await readGeneratedStepJson(REPO_ROOT));
  const violations = pooledAdmissionBudgetViolations(steps, budget);
  for (const violation of violations) {
    console.error(`CI admission budget: ${violation}`);
  }
  if (violations.length > 0) process.exit(1);
  console.log(
    `CI admission budget holds for ${steps.length.toString()} generated steps`,
  );
}

if (import.meta.main) {
  await main();
}
