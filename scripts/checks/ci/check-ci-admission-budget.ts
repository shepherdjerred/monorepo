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
    const largestServices = Math.max(
      ...podSteps.map((step) =>
        (step.services ?? []).reduce(
          (sum, service) => sum + request(service.resources, resource),
          0,
        ),
      ),
    );
    // Every in-flight workflow holding its services, while one more step
    // still needs admitting.
    const worstCase = budget.maxWorkflows * largestServices + largestStep;
    if (worstCase > quota) {
      violations.push(
        `${resource}: ${budget.maxWorkflows.toString()} workflows' services (${String(largestServices)} each) plus the largest step (${String(largestStep)}) need ${String(worstCase)}, over the ${budget.quota[resource]} quota; admitted services could starve every step`,
      );
    }
  }
  return violations;
}

async function main(): Promise<void> {
  const budget = BudgetSchema.parse(await Bun.file(BUDGET_PATH).json());
  const steps = z
    .array(StepSchema)
    .parse(await readGeneratedStepJson(REPO_ROOT));
  const violations = admissionBudgetViolations(steps, budget);
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
