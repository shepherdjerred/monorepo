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
 *   cdk8s builds the Kueue ClusterQueues and the agents' workflow caps;
 * - the generator's step model, from `dump-steps.ts`.
 *
 * The reserved queues are proved differently: the gate and light reserves
 * must each hold every one of their slots at once, so their pods are never
 * gated and their workflows wait only for a slot.
 */

import path from "node:path";
import { z } from "zod";
import {
  CHECKED_STEP_GRAPHS,
  readGeneratedStepJson,
} from "../../lib/ci/generated-steps.ts";
import {
  type AdmissionBudgetSchema,
  PooledAdmissionBudgetSchema,
  queueWorkflows,
} from "../../lib/ci/admission-budget.ts";

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

export const StepSchema = z.object({
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
  /** The largest clone pod a checkout runs before the step, one at a time. */
  checkout: TierSchema.optional(),
  services: z
    .array(z.object({ name: z.string(), resources: TierSchema }))
    .optional(),
});

export type AdmissionStep = z.infer<typeof StepSchema>;

export type AdmissionBudget = z.infer<typeof AdmissionBudgetSchema>;

export type PooledAdmissionBudget = z.infer<typeof PooledAdmissionBudgetSchema>;

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

/**
 * Compute slots that take only the workflows routed to them, every one of
 * which the step model lists. They can hold only those workflows' services.
 */
export type DedicatedSlots = {
  readonly steps: readonly AdmissionStep[];
  readonly workflows: number;
};

// macOS lanes run on the Mac's local backend: no pod, nothing to admit.
const kubernetesSteps = (steps: readonly AdmissionStep[]) =>
  steps.filter((step) => step.backend !== "local");

export function admissionBudgetViolations(
  steps: readonly AdmissionStep[],
  budget: AdmissionBudget,
  dedicated: readonly DedicatedSlots[] = [],
): string[] {
  const violations: string[] = [];
  const slots = [
    { steps: kubernetesSteps(steps), workflows: budget.maxWorkflows },
    ...dedicated.map((group) => ({
      steps: kubernetesSteps(group.steps),
      workflows: group.workflows,
    })),
  ];
  const podSteps = slots.flatMap((group) => group.steps);
  if (podSteps.length === 0) {
    return ["the step model has no Kubernetes steps; is the dump empty?"];
  }
  const workflows = slots.reduce((sum, group) => sum + group.workflows, 0);

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
    const services = slots.reduce(
      (sum, group) =>
        sum + heldServices(group.steps, group.workflows, resource),
      0,
    );
    // Every in-flight workflow holding its services, while one more step
    // still needs admitting.
    const worstCase = services + largestStep;
    if (worstCase > quota) {
      violations.push(
        `${resource}: ${workflows.toString()} workflows' held services (${String(services)}) plus the largest step (${String(largestStep)}) need ${String(worstCase)}, over the ${budget.quota[resource]} quota; admitted services could starve every step`,
      );
    }
  }
  return violations;
}

/**
 * A workflow whose pool has no agent waits in Woodpecker forever, so every
 * routed Kubernetes workflow must name a pool the budget gives an agent.
 */
function unroutableViolations(
  steps: readonly AdmissionStep[],
  poolQueue: ReadonlyMap<string, string>,
): string[] {
  return steps.flatMap((step) => {
    const pool = step.agentLabels?.["ci-pool"];
    return pool === undefined || step.backend === "local" || poolQueue.has(pool)
      ? []
      : [
          `${step.key}: routed to the ${pool} pool, which has no agent in the budget`,
        ];
  });
}

/**
 * PR and main run the ordinary graph, which the step model routes once as a
 * pull request, so any of their slots may hold any of its workflows. That
 * includes the workflows a pull request routes to `pr-light`: a main push
 * runs them in the main pool, against compute quota.
 */
const SHARED_COMPUTE_POOLS: ReadonlySet<string> = new Set(["pr", "main"]);

/**
 * The light reserve holds every `pr-light` slot at once, so Kueue never gates
 * a light pod and a light workflow waits only for one of its own slots. A
 * workflow runs its checkout pods and then each container one at a time, so a
 * slot needs the largest of them, per resource, and never two together.
 */
function lightViolations(
  lightSteps: readonly AdmissionStep[],
  workflows: number,
  quota: PooledAdmissionBudget["lightQuota"],
): string[] {
  const violations = lightSteps
    .filter(
      (step) => step.backend === "local" || (step.services?.length ?? 0) !== 0,
    )
    .map(
      (step) =>
        `${step.key}: the pr-light pool requires a Kubernetes workflow without services`,
    );
  if (lightSteps.length === 0) return violations;
  for (const resource of METERED) {
    const slot = Math.max(
      ...lightSteps.flatMap((step) => [
        request(step.resources, resource),
        step.checkout === undefined ? 0 : request(step.checkout, resource),
      ]),
    );
    if (workflows * slot > parseQuantity(quota[resource])) {
      violations.push(
        `${resource}: all ${workflows.toString()} pr-light slots, each holding its largest pod (${String(slot)}), must fit the ${quota[resource]} light reserve at once`,
      );
    }
  }
  return violations;
}

/**
 * Split compute slots by what they can run. Every other compute pool, such as
 * maintenance, takes only the workflows routed to it, so its slots never hold
 * an ordinary workflow's services.
 */
function computeSlots(
  computeSteps: readonly AdmissionStep[],
  pools: PooledAdmissionBudget["pools"],
): { shared: DedicatedSlots; dedicated: DedicatedSlots[] } {
  const pool = (step: AdmissionStep) => step.agentLabels?.["ci-pool"] ?? "";
  const dedicated = Object.entries(pools).filter(
    ([name, entry]) =>
      entry.queue === "default" && !SHARED_COMPUTE_POOLS.has(name),
  );
  const dedicatedNames = new Set(dedicated.map(([name]) => name));
  return {
    shared: {
      steps: computeSteps.filter((step) => !dedicatedNames.has(pool(step))),
      workflows:
        queueWorkflows(pools, "default") -
        dedicated.reduce((sum, [, entry]) => sum + entry.maxWorkflows, 0),
    },
    dedicated: dedicated.map(([name, entry]) => ({
      steps: computeSteps.filter((step) => pool(step) === name),
      workflows: entry.maxWorkflows,
    })),
  };
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
        parseQuantity(budget.lightQuota[resource]) +
        parseQuantity(budget.gateQuota[resource]) !==
      parseQuantity(budget.quota[resource])
    ) {
      violations.push(
        `${resource}: compute, light and gate quotas must sum to the existing aggregate budget`,
      );
    }
  }

  const poolQueue = new Map(
    Object.entries(pools).map(([name, pool]) => [name, pool.queue]),
  );
  violations.push(...unroutableViolations(steps, poolQueue));
  const queueOf = (step: AdmissionStep) =>
    poolQueue.get(step.agentLabels?.["ci-pool"] ?? "");
  const gateSteps = steps.filter((step) => queueOf(step) === "ci-gates");
  violations.push(
    ...lightViolations(
      steps.filter((step) => queueOf(step) === "ci-light"),
      queueWorkflows(pools, "ci-light"),
      budget.lightQuota,
    ),
  );
  // Light workflows stay in the compute proof: main runs them there.
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
  const { shared, dedicated } = computeSlots(computeSteps, pools);
  violations.push(
    ...admissionBudgetViolations(
      shared.steps,
      {
        maxWorkflows: budget.legacyMaxWorkflows + shared.workflows,
        maxServicesPerWorkflow: budget.maxServicesPerWorkflow,
        quota: budget.computeQuota,
      },
      dedicated,
    ),
  );

  const gateWorkflows = queueWorkflows(pools, "ci-gates");
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
  const budget = PooledAdmissionBudgetSchema.parse(
    await Bun.file(BUDGET_PATH).json(),
  );
  // Each graph is admitted on its own; the flag-on producers must fit before
  // the window turns them on.
  let checked = 0;
  const violations: string[] = [];
  for (const graph of CHECKED_STEP_GRAPHS) {
    const steps = z.array(StepSchema).parse(
      await readGeneratedStepJson(REPO_ROOT, {
        includeCanaries: true,
        graph,
      }),
    );
    checked += steps.length;
    const label = graph.length === 0 ? "default graph" : graph.join(" ");
    for (const violation of pooledAdmissionBudgetViolations(steps, budget))
      violations.push(`${label}: ${violation}`);
  }
  for (const violation of violations) {
    console.error(`CI admission budget: ${violation}`);
  }
  if (violations.length > 0) process.exit(1);
  console.log(
    `CI admission budget holds for ${checked.toString()} generated steps across ${CHECKED_STEP_GRAPHS.length.toString()} pipeline graphs`,
  );
}

if (import.meta.main) {
  await main();
}
