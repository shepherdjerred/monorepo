/** Wire shapes of the GitHub reads behind `ci wait`, validated at the boundary. */
import { z } from "zod";

export const UserSchema = z
  .object({ login: z.string(), type: z.string() })
  .nullable();
export const PrSchema = z.object({
  number: z.number(),
  html_url: z.url(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  merge_commit_sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/u)
    .nullish(),
  draft: z.boolean(),
  mergeable: z.boolean().nullable(),
  mergeable_state: z.enum([
    "clean",
    "unstable",
    "dirty",
    "unknown",
    "blocked",
    "draft",
    "behind",
    "has_hooks",
  ]),
  head: z.object({ sha: z.string() }),
  base: z.object({ sha: z.string(), ref: z.string() }),
});
export type CiPullRequest = z.infer<typeof PrSchema>;
export const ReviewSchema = z.object({
  id: z.number(),
  node_id: z.string(),
  user: UserSchema,
  body: z.string().nullable(),
  html_url: z.url(),
  state: z.enum([
    "APPROVED",
    "CHANGES_REQUESTED",
    "COMMENTED",
    "PENDING",
    "DISMISSED",
  ]),
  submitted_at: z.string().nullable(),
  commit_id: z.string(),
});
export type CiReview = z.infer<typeof ReviewSchema>;
export const RuleSchema = z.object({
  type: z.string(),
  parameters: z
    .object({
      required_status_checks: z
        .array(
          z.object({
            context: z.string(),
            integration_id: z.number().optional(),
          }),
        )
        .optional(),
      strict_required_status_checks_policy: z.boolean().optional(),
      required_approving_review_count: z.number().optional(),
    })
    .optional(),
});
export type RequiredCheck = { name: string; appId: number | null };
export const RequiredStatusParameters = z.object({
  required_status_checks: z.array(
    z.object({ context: z.string(), integration_id: z.number().optional() }),
  ),
  strict_required_status_checks_policy: z.boolean(),
});
export const RequiredReviewParameters = z.object({
  required_approving_review_count: z.number().int().nonnegative(),
});
export type CiRules = {
  checks: RequiredCheck[];
  strict: boolean;
  approvals: number;
};
export type CommitCheck = {
  name: string;
  state: "pass" | "fail" | "pending" | "human_action";
  url: string | null;
  appId: number | null;
};
export const StatusSchema = z.object({
  context: z.string(),
  state: z.enum(["success", "failure", "error", "pending"]),
  target_url: z.string().nullable(),
});
export const CheckRunSchema = z.object({
  name: z.string(),
  head_sha: z.string(),
  status: z.enum([
    "queued",
    "in_progress",
    "completed",
    "waiting",
    "requested",
    "pending",
  ]),
  conclusion: z
    .enum([
      "success",
      "failure",
      "neutral",
      "cancelled",
      "skipped",
      "timed_out",
      "action_required",
      "startup_failure",
      "stale",
    ])
    .nullable(),
  html_url: z.string().nullable(),
  app: z.object({ id: z.number() }).nullable(),
});

export const DecisionSchema = z.object({
  headRefOid: z.string(),
  baseRefOid: z.string(),
  reviewDecision: z
    .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
    .nullable(),
});
export type PrDecision = z.infer<typeof DecisionSchema>;
export const MemoSchema = z.object({
  readAt: z.number(),
  decision: DecisionSchema,
});
export const RulesMemoSchema = z.object({
  readAt: z.number(),
  rules: z.object({
    checks: z.array(
      z.object({ name: z.string(), appId: z.number().nullable() }),
    ),
    strict: z.boolean(),
    approvals: z.number(),
  }),
});
export const RateLimitQuerySchema = z.object({
  rateLimit: z.object({
    limit: z.number(),
    remaining: z.number(),
    used: z.number(),
    resetAt: z.string(),
  }),
});

export async function addLegacyProtection(
  response: Response,
  result: CiRules,
): Promise<void> {
  if (response.status === 404) return;
  if (!response.ok)
    throw new Error(
      `GitHub branch protection read failed (${String(response.status)})`,
    );
  const value = z
    .object({
      required_status_checks: z
        .object({
          strict: z.boolean(),
          checks: z.array(
            z.object({ context: z.string(), app_id: z.number().nullable() }),
          ),
        })
        .nullable()
        .optional(),
      required_pull_request_reviews: z
        .object({ required_approving_review_count: z.number() })
        .nullable()
        .optional(),
    })
    .parse(await response.json());
  result.strict ||= value.required_status_checks?.strict === true;
  result.approvals = Math.max(
    result.approvals,
    value.required_pull_request_reviews?.required_approving_review_count ?? 0,
  );
  for (const check of value.required_status_checks?.checks ?? [])
    result.checks.push({
      name: check.context,
      appId: check.app_id === null || check.app_id < 0 ? null : check.app_id,
    });
}

export function checkRunState(
  status: string,
  conclusion: string | null,
): CommitCheck["state"] {
  if (status !== "completed") return "pending";
  if (conclusion === "action_required") return "human_action";
  if (["success", "neutral", "skipped"].includes(conclusion ?? ""))
    return "pass";
  if (conclusion === null)
    throw new Error("Completed GitHub check has no conclusion");
  return "fail";
}
