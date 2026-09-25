import { z } from "zod";
import rawCiAdmissionBudget from "./ci-admission-budget.json" with { type: "json" };

const CiAdmissionBudgetSchema = z
  .object({
    $comment: z.string(),
    maxWorkflows: z.number().int().positive(),
    maxServicesPerWorkflow: z.number().int().nonnegative(),
    quota: z
      .object({
        cpu: z.string().min(1),
        memory: z.string().min(1),
        "ephemeral-storage": z.string().min(1),
      })
      .strict(),
  })
  .strict();

/**
 * The CI admission budget, from its language-neutral source
 * (`ci-admission-budget.json`), which the root admission-budget check also
 * reads to prove the generated pipeline fits it.
 */
export const CI_ADMISSION_BUDGET =
  CiAdmissionBudgetSchema.parse(rawCiAdmissionBudget);

/**
 * Cluster-wide cap on concurrently-running CI workflows.
 *
 * Direct successor to Buildkite's max-in-flight cap, sized during the 2026-07 CI
 * freeze incident response. Woodpecker enforces it per agent via
 * `WOODPECKER_MAX_WORKFLOWS` rather than through a controller-side scheduler,
 * so a single agent replica makes this the cluster-wide bound. A count, so it
 * bounds nothing about size: Kueue's resource quota does that.
 */
export const WOODPECKER_MAX_WORKFLOWS = CI_ADMISSION_BUDGET.maxWorkflows;

/** Public origin GitHub reaches for webhooks and OAuth callbacks. */
export const WOODPECKER_PUBLIC_HOST = "https://woodpecker.sjer.red";

/** Port the server serves HTTP (web UI, webhooks, OAuth) on. */
export const WOODPECKER_HTTP_PORT = 8000;

/** Port agents reach the server's gRPC endpoint on. */
export const WOODPECKER_GRPC_PORT = 9000;
