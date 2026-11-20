import { createHash, randomUUID } from "node:crypto";
import type {
  AttemptContext,
  PassReason,
  TaskState,
} from "#src/domain/schemas.ts";
import type { GitHubClient } from "#src/integrations/github.ts";
import type { TrackerClient } from "#src/integrations/tracker.ts";
import type { WithGitHub, TaskStore } from "#src/reconcile-merge.ts";
import { currentTimestamp } from "#src/runtime/time.ts";

type IssueContext = NonNullable<
  Awaited<ReturnType<TrackerClient["issueContext"]>>
>;

function digest(parts: readonly (string | null)[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function snapshotAttempt({
  issue,
  comments,
}: IssueContext): AttemptContext {
  return {
    issueDigest: digest([issue.title, issue.description]),
    humanComments: comments
      .filter((comment) => comment.author.kind === "human")
      .map((comment) => ({
        id: comment.id,
        digest: digest([comment.body, comment.editedAt]),
      })),
  };
}

export function hasNewAttemptContext(
  previous: AttemptContext,
  current: AttemptContext,
): boolean {
  if (previous.issueDigest !== current.issueDigest) return true;
  const known = new Map(
    previous.humanComments.map(({ id, digest: hash }) => [id, hash]),
  );
  return current.humanComments.some(
    ({ id, digest: hash }) => known.get(id) !== hash,
  );
}

export async function preparePassedRetry(
  state: TaskState,
  tracker: Pick<TrackerClient, "issueContext">,
) {
  if (state.phase !== "passed" || state.attemptContext === undefined)
    return null;
  const current = await tracker.issueContext(state.issue.identifier);
  if (current === null) return null;
  const { issue } = current;
  if (
    issue.archivedAt != null ||
    ["completed", "canceled", "duplicate"].includes(issue.state.type)
  )
    return null;
  const context = snapshotAttempt(current);
  return hasNewAttemptContext(state.attemptContext, context)
    ? { issue, context }
    : null;
}

/** Private Tracker evidence. Never reuse agent or command text in telemetry. */
export function privateEvidence(text: string): string {
  return text
    .replaceAll(
      /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
      "[redacted]",
    )
    .replaceAll(/\bBearer\s+[\w.\-+/=]+/gi, "Bearer [redacted]")
    .replaceAll(/\b(?:sk-|ghp_|ghs_|github_pat_)[\w-]{8,}/g, "[redacted]")
    .replaceAll(
      /\b([\w-]*(?:token|key|password|secret|credential)[\w-]*)(["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
      "$1$2[redacted]",
    )
    .trim()
    .slice(0, 3000);
}

export async function passTask(input: {
  state: TaskState;
  reason: PassReason;
  note: string;
  store: TaskStore;
}) {
  if (input.state.attemptContext === undefined)
    throw new Error("Passing a task requires a Tracker context snapshot");
  await input.store.save({
    ...input.state,
    phase: "passing",
    resumePhase: null,
    previousApprovalIds: undefined,
    lastPass: {
      id: randomUUID(),
      reason: input.reason,
      note: privateEvidence(input.note),
      closedPullRequest: input.state.lastPass?.closedPullRequest ?? false,
    },
    updatedAt: currentTimestamp(),
  });
}

async function taskPullRequest(
  github: GitHubClient,
  state: TaskState,
  baseBranch: string,
) {
  const pr =
    state.prNumber === null
      ? await github.pullRequestForBranch(state.branch)
      : await github.pullRequest(state.prNumber);
  if (
    pr !== null &&
    (pr.headRefName !== state.branch || pr.baseRefName !== baseBranch)
  )
    throw new Error("Pull request branch changed before parking task");
  return pr;
}

export async function finishPass(input: {
  state: TaskState;
  tracker: Pick<TrackerClient, "parkPass" | "refreshIssue">;
  withGitHub: WithGitHub;
  store: TaskStore;
  baseBranch: string;
}): Promise<void> {
  const { state, tracker, withGitHub, store, baseBranch } = input;
  const record = state.lastPass;
  if (record === undefined || state.phase !== "passing")
    throw new Error("No durable pass to finish");
  const parked = await withGitHub(async (github) => {
    const pr = await taskPullRequest(github, state, baseBranch);
    if (pr === null) return state;
    const attached = {
      ...state,
      prNumber: pr.number,
      prUrl: pr.url,
      latestHeadSha: pr.headRefOid,
    };
    if (pr.state === "MERGED") {
      await store.save({
        ...attached,
        phase: "merging",
        updatedAt: currentTimestamp(),
      });
      return null;
    }
    if (pr.state === "CLOSED") return attached;
    const closing = {
      ...attached,
      lastPass: { ...record, closedPullRequest: true },
      updatedAt: currentTimestamp(),
    };
    await store.save(closing);
    await github.setPullRequestOpen(pr.number, false);
    return closing;
  });
  if (parked === null) return;
  const issue = await tracker.refreshIssue(state.issue.identifier);
  if (
    issue !== null &&
    issue.archivedAt == null &&
    !["completed", "canceled", "duplicate"].includes(issue.state.type)
  ) {
    const body = [
      "Justin passed on this attempt.",
      record.note,
      "Justin will reconsider this issue after an edit or new human feedback here.",
      `<!-- justin-pass:${record.id} -->`,
    ].join("\n\n");
    await tracker.parkPass(issue, body);
  }
  await store.save({
    ...parked,
    phase: "passed",
    updatedAt: currentTimestamp(),
  });
}
