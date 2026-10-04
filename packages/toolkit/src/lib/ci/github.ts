import { z } from "zod";
import { isProviderAuthor, PROVIDERS } from "@shepherdjerred/code-review";
import { captureJson } from "./process.ts";
import { PullRequestSchema } from "#lib/github/schemas.ts";

export const REPOSITORY = "shepherdjerred/monorepo";
const API = "https://api.github.com";
const UserSchema = z.object({ login: z.string(), type: z.string() }).nullable();
export const PrSchema = z.object({
  number: z.number(),
  html_url: z.url(),
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
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
const RuleSchema = z.object({
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
const RequiredStatusParameters = z.object({
  required_status_checks: z.array(
    z.object({ context: z.string(), integration_id: z.number().optional() }),
  ),
  strict_required_status_checks_policy: z.boolean(),
});
const RequiredReviewParameters = z.object({
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
const StatusSchema = z.object({
  context: z.string(),
  state: z.enum(["success", "failure", "error", "pending"]),
  target_url: z.string().nullable(),
});
const CheckRunSchema = z.object({
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

export class GitHubClient {
  constructor(
    readonly token: string,
    readonly repo: string = REPOSITORY,
  ) {}

  async response(path: string, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(new URL(path, API), {
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal:
        signal === undefined
          ? AbortSignal.timeout(30_000)
          : AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    return response;
  }

  async read<T>(
    path: string,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.response(path, signal);
    if (!response.ok)
      throw new Error(
        `GitHub request failed (${String(response.status)}): ${path}`,
      );
    return schema.parse(await response.json());
  }

  async pages<T>(
    path: string,
    schema: z.ZodType<T[]>,
    signal?: AbortSignal,
  ): Promise<T[]> {
    const output: T[] = [];
    for (let page = 1; ; page++) {
      const separator = path.includes("?") ? "&" : "?";
      const batch = await this.read(
        `${path}${separator}per_page=100&page=${String(page)}`,
        schema,
        signal,
      );
      output.push(...batch);
      if (batch.length < 100) return output;
    }
  }

  pr(number: number, signal?: AbortSignal): Promise<CiPullRequest> {
    return this.read(
      `/repos/${this.repo}/pulls/${String(number)}`,
      PrSchema,
      signal,
    );
  }

  async decision(number: number, signal?: AbortSignal) {
    const [owner, name] = this.repo.split("/");
    const response = await fetch(`${API}/graphql`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal:
        signal === undefined
          ? AbortSignal.timeout(30_000)
          : AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      body: JSON.stringify({
        query:
          "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid baseRefOid reviewDecision}}}",
        variables: { owner, name, number },
      }),
    });
    if (!response.ok)
      throw new Error(`GitHub GraphQL failed (${String(response.status)})`);
    const result = z
      .object({
        errors: z.array(z.unknown()).optional(),
        data: z
          .object({
            repository: z.object({
              pullRequest: z.object({
                headRefOid: z.string(),
                baseRefOid: z.string(),
                reviewDecision: z
                  .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
                  .nullable(),
              }),
            }),
          })
          .optional(),
      })
      .parse(await response.json());
    if (result.errors !== undefined || result.data === undefined)
      throw new Error("GitHub GraphQL did not return a PR decision");
    return result.data.repository.pullRequest;
  }

  reviews(number: number, signal?: AbortSignal): Promise<CiReview[]> {
    return this.pages(
      `/repos/${this.repo}/pulls/${String(number)}/reviews`,
      z.array(ReviewSchema),
      signal,
    );
  }

  async rules(branch: string, signal?: AbortSignal): Promise<CiRules> {
    const prefix = `/repos/${this.repo}`;
    const [rules, protection] = await Promise.all([
      this.pages(
        `${prefix}/rules/branches/${encodeURIComponent(branch)}`,
        z.array(RuleSchema),
        signal,
      ),
      this.response(
        `${prefix}/branches/${encodeURIComponent(branch)}/protection`,
        signal,
      ),
    ]);
    const result: CiRules = { checks: [], strict: false, approvals: 0 };
    for (const rule of rules) {
      if (rule.type === "required_status_checks") {
        const parameters = RequiredStatusParameters.parse(rule.parameters);
        result.strict ||= parameters.strict_required_status_checks_policy;
        for (const check of parameters.required_status_checks) {
          result.checks.push({
            name: check.context,
            appId:
              check.integration_id === undefined || check.integration_id < 0
                ? null
                : check.integration_id,
          });
        }
      }
      if (rule.type === "pull_request")
        result.approvals = Math.max(
          result.approvals,
          RequiredReviewParameters.parse(rule.parameters)
            .required_approving_review_count,
        );
    }
    await addLegacyProtection(protection, result);
    return result;
  }

  async checks(sha: string, signal?: AbortSignal): Promise<CommitCheck[]> {
    const prefix = `/repos/${this.repo}/commits/${sha}`;
    const [statuses, runs] = await Promise.all([
      this.pages(`${prefix}/statuses`, z.array(StatusSchema), signal),
      this.pages(
        `${prefix}/check-runs?filter=latest`,
        z
          .object({ check_runs: z.array(CheckRunSchema) })
          .transform((value) => value.check_runs),
        signal,
      ),
    ]);
    const latest = new Map<string, CommitCheck>();
    for (const status of statuses) {
      if (!latest.has(status.context))
        latest.set(status.context, {
          name: status.context,
          state:
            status.state === "success"
              ? "pass"
              : status.state === "pending"
                ? "pending"
                : "fail",
          url: status.target_url,
          appId: null,
        });
    }
    return [
      ...latest.values(),
      ...runs
        .filter((run) => run.head_sha === sha)
        .map((run): CommitCheck => ({
          name: run.name,
          state: checkRunState(run.status, run.conclusion),
          url: run.html_url,
          appId: run.app?.id ?? null,
        })),
    ];
  }
}

async function addLegacyProtection(
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

function checkRunState(
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

export function isHumanReview(review: CiReview): boolean {
  return (
    review.user !== null &&
    review.user.type !== "Bot" &&
    !Object.values(PROVIDERS).some((provider) =>
      isProviderAuthor(provider, review.user?.login ?? null),
    )
  );
}

export async function resolvePrNumber(
  number?: string,
  repo: string = REPOSITORY,
): Promise<number> {
  if (number !== undefined)
    return z.coerce.number().int().positive().parse(number);
  const pr = await captureJson(
    [
      "gh",
      "pr",
      "view",
      "--repo",
      repo,
      "--json",
      "number,title,url,headRefName,headRefOid,baseRefName,state,isDraft,mergeable,reviewDecision",
    ],
    PullRequestSchema,
  );
  return pr.number;
}
