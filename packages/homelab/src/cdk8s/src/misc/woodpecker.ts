import { PooledAdmissionBudgetSchema } from "@shepherdjerred/root-scripts/lib/ci/admission-budget.ts";
import rawCiAdmissionBudget from "./ci-admission-budget.json" with { type: "json" };

/**
 * The CI admission budget, from its language-neutral source
 * (`ci-admission-budget.json`), which the root admission-budget check also
 * reads to prove the generated pipeline fits it.
 */
export const CI_ADMISSION_BUDGET =
  PooledAdmissionBudgetSchema.parse(rawCiAdmissionBudget);

/**
 * The existing agent keeps its exact pod template while dedicated pools are
 * introduced. Remove it only after old, unlabelled workflows have drained.
 */
export const WOODPECKER_MAX_WORKFLOWS = CI_ADMISSION_BUDGET.legacyMaxWorkflows;

export type CiAgentPool = keyof typeof CI_ADMISSION_BUDGET.pools;

export const CI_COMPUTE_WORKFLOWS =
  CI_ADMISSION_BUDGET.legacyMaxWorkflows +
  CI_ADMISSION_BUDGET.pools.pr.maxWorkflows +
  CI_ADMISSION_BUDGET.pools.main.maxWorkflows;

export const CI_GATE_WORKFLOWS =
  CI_ADMISSION_BUDGET.pools.review.maxWorkflows +
  CI_ADMISSION_BUDGET.pools.completion.maxWorkflows;

/** Public origin GitHub reaches for webhooks and OAuth callbacks. */
export const WOODPECKER_PUBLIC_HOST = "https://woodpecker.sjer.red";

/** Port the server serves HTTP (web UI, webhooks, OAuth) on. */
export const WOODPECKER_HTTP_PORT = 8000;

/** Port agents reach the server's gRPC endpoint on. */
export const WOODPECKER_GRPC_PORT = 9000;
