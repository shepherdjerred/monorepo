import { z } from "zod";

const Quota = z
  .object({
    cpu: z.string().min(1),
    memory: z.string().min(1),
    "ephemeral-storage": z.string().min(1),
  })
  .strict();

export const AdmissionBudgetSchema = z.object({
  maxWorkflows: z.number().int().positive(),
  maxServicesPerWorkflow: z.number().int().nonnegative(),
  quota: Quota,
});

/**
 * The Kueue LocalQueue an agent pool's pods join: compute, the light reserve
 * for short service-free PR checks, or the gate reserve.
 */
export type PoolQueue = "default" | "ci-light" | "ci-gates";

const pool = (queue: PoolQueue) =>
  z
    .object({
      maxWorkflows: z.number().int().positive(),
      queue: z.literal(queue),
    })
    .strict();

/** Shared validator for the language-neutral budget used by CI and cdk8s. */
export const PooledAdmissionBudgetSchema = AdmissionBudgetSchema.extend({
  $comment: z.string(),
  legacyMaxWorkflows: z.number().int().nonnegative(),
  computeQuota: Quota,
  lightQuota: Quota,
  gateQuota: Quota,
  pools: z
    .object({
      pr: pool("default"),
      main: pool("default"),
      // Temporal-dispatched maintenance (golden workspace, CI images, seeds,
      // release notes) has its own agent so it never waits behind the PR
      // backlog, but its pods still queue for compute quota.
      maintenance: pool("default"),
      // Short, service-free PR checks (scanners, the draft preflight, small
      // contained checks) have their own agent and a reserved queue that fits
      // every slot at once, so they never wait behind verify for a slot or
      // for quota.
      "pr-light": pool("ci-light"),
      review: pool("ci-gates"),
      completion: pool("ci-gates"),
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

/**
 * Workflow slots whose pods join `queue`. Pods quotas and the admission proof
 * size each queue from this, so a pool added to the budget is counted in the
 * queue it names rather than in a hard-coded list.
 */
export function queueWorkflows(
  pools: Readonly<Record<string, { maxWorkflows: number; queue: PoolQueue }>>,
  queue: PoolQueue,
): number {
  return Object.values(pools)
    .filter((entry) => entry.queue === queue)
    .reduce((sum, entry) => sum + entry.maxWorkflows, 0);
}
