/**
 * Finding review gates that failed for a reason that has since gone away.
 *
 * The gate fails when its deadline expires before the provider's review lands.
 * If the review arrives afterwards and carries nothing blocking, the job is
 * simply stale: re-running it passes without a single change to the PR. That
 * rule is fully decidable, and re-deciding it by hand on every stuck PR is how
 * it was applied before this existed.
 */

import { z } from "zod";

const GITHUB_API = "https://api.github.com";

export const CODEX_GATE_CONTEXT =
  "buildkite/monorepo/pr/robot-face-codex-review-gate-required";

/** The provider gate that must be harvested for a PR. */
export const REQUIRED_REVIEW_GATES = [
  { providerId: "codex", context: CODEX_GATE_CONTEXT },
] as const;

const StatusSchema = z.object({
  state: z.string(),
  statuses: z.array(
    z.object({
      context: z.string(),
      state: z.string(),
      target_url: z.string().nullable(),
    }),
  ),
});

export type GateStatus = {
  state: string;
  targetUrl: string | null;
};

/**
 * The Buildkite job id a gate status points at.
 *
 * Buildkite writes the job into the URL fragment (`…/builds/9633#<uuid>`), so
 * retrying the failed job — rather than rebuilding everything — means reading
 * it back out of there.
 */
export function jobIdFromTargetUrl(targetUrl: string | null): string | null {
  if (targetUrl === null) return null;
  const fragment = targetUrl.split("#")[1];
  if (fragment === undefined || fragment === "") return null;
  // Matched as a UUID rather than as 36 hex-or-hyphen characters: the loose
  // form accepted strings like 36 hyphens, and every non-null id here is
  // reported as retryable and handed to `bk job retry`.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
    fragment,
  )
    ? fragment
    : null;
}

/** The `rel="next"` URL of a GitHub `Link` header, or null on the last page. */
export function nextPageUrl(link: string | null): string | null {
  if (link === null) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="next"/u.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/**
 * The review gate's status for a commit, or null when it posted none.
 *
 * The commit-status list is paginated, and `null` here is read by
 * `harvestVerdict` as "this PR has no gate to retry". Stopping at the first
 * page would turn a gate that merely sorted onto a later page into that answer
 * — a stale gate reported as nothing to do, which is the one outcome this
 * module exists to prevent. So every page is read before answering `null`.
 */
export async function gateStatusFor(input: {
  repo: string;
  ref: string;
  token: string;
  context?: string;
}): Promise<GateStatus | null> {
  const context = input.context ?? CODEX_GATE_CONTEXT;
  let url: string | null =
    `${GITHUB_API}/repos/${input.repo}/commits/${input.ref}/status?per_page=100`;
  while (url !== null) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Could not read status for ${input.repo}@${input.ref}: ` +
          `${String(response.status)} ${response.statusText}`,
      );
    }
    const parsed = StatusSchema.parse(await response.json());
    const gate = parsed.statuses.find((status) => status.context === context);
    if (gate !== undefined) {
      return { state: gate.state, targetUrl: gate.target_url };
    }
    url = nextPageUrl(response.headers.get("link"));
  }
  return null;
}

export type HarvestVerdict =
  { retryable: true; jobId: string } | { retryable: false; reason: string };

/**
 * Whether a failed gate is stale rather than correct.
 *
 * Every condition has to hold: the gate failed, the review that exists is for
 * the commit the gate judged, the provider actually finished, and nothing it
 * found blocks. Retrying on any weaker rule re-runs a job that will fail again,
 * which reads as flakiness rather than as the gate doing its job.
 */
export function harvestVerdict(input: {
  gate: GateStatus | null;
  reviewedAtHead: boolean;
  completionSignal: string;
  blockingCount: number;
}): HarvestVerdict {
  if (input.gate === null)
    return { retryable: false, reason: "no gate status" };
  if (input.gate.state !== "failure") {
    return { retryable: false, reason: `gate is ${input.gate.state}` };
  }
  if (!input.reviewedAtHead) {
    return { retryable: false, reason: "no review for this head yet" };
  }
  if (input.completionSignal === "none") {
    return { retryable: false, reason: "provider has not finished reviewing" };
  }
  if (input.blockingCount > 0) {
    return {
      retryable: false,
      reason: `${String(input.blockingCount)} blocking finding(s) remain`,
    };
  }
  const jobId = jobIdFromTargetUrl(input.gate.targetUrl);
  if (jobId === null) {
    return { retryable: false, reason: "gate status names no Buildkite job" };
  }
  return { retryable: true, jobId };
}
