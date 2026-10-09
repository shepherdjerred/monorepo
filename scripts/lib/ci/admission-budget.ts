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

const pool = (queue: "default" | "ci-gates") =>
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
  gateQuota: Quota,
  pools: z
    .object({
      pr: pool("default"),
      main: pool("default"),
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
