/**
 * Head-push-time resolution for the review gate: determining the ISO instant a
 * commit became the PR's head, and whether a commit-less 👍 reaction can be
 * bound to that head. Pure logic (plus GitHub fetch wrappers) split out of
 * `./github.ts` so it is unit-testable with fixtures and keeps that module
 * under its size budget.
 */

import { z } from "zod";
import {
  arrayField,
  asRecord,
  getJsonWithLink,
  GITHUB_API_URL,
  graphqlRequest,
  recordField,
  splitRepo,
  stringField,
} from "./github-http.ts";

// One Repository-Activity item — only the fields we depend on. Extra keys
// (activity_type, ref, actor, before, id) are stripped, but a response that is
// not an array of objects carrying these two string fields is a contract
// regression and must fail loudly (see fetchRefUpdateTime) rather than be
// silently treated as "no activity" — which would masquerade as a review
// timeout.
const RepositoryActivitySchema = z.object({
  after: z.string(),
  timestamp: z.string(),
});

const HEAD_REF_UPDATED_AT_QUERY = `
query($owner: String!, $name: String!, $oid: GitObjectID!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit { pushedDate }
    }
    pullRequest(number: $number) {
      headRefName
      headRepository { nameWithOwner }
      timelineItems(last: 50, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) {
        nodes {
          ... on HeadRefForcePushedEvent {
            createdAt
            afterCommit { oid }
          }
        }
      }
    }
  }
}`;

// Cap Activity-API pagination. The query is filtered to a single PR branch, so
// its push/force-push/branch-creation history is tiny and newest-first; the
// head's ref update is on page 1. The cap only guards a pathological branch and,
// if ever hit, yields null (unbound) — safe, never a false bind.
const MAX_ACTIVITY_PAGES = 10;

function latestIso(candidates: readonly (string | null)[]): string | null {
  let best: string | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate === null) continue;
    const score = Date.parse(candidate);
    if (Number.isFinite(score) && score >= bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Pure: the latest Repository-Activity `timestamp` whose `after` SHA equals the
 * head — the real instant the ref was moved to this commit (a `push`,
 * `force_push`, or `branch_creation`). Exported for tests.
 */
/**
 * Validate one Repository-Activity API page, THROWING on a contract regression
 * (a non-array payload or an item missing `after`/`timestamp`) rather than
 * silently reducing it to "no activity". Exported for tests.
 */
export function parseActivityPage(
  payload: unknown,
): z.infer<typeof RepositoryActivitySchema>[] {
  return z.array(RepositoryActivitySchema).parse(payload);
}

export function pickRefUpdateTime(
  activities: readonly unknown[],
  sha: string,
): string | null {
  const times: (string | null)[] = [];
  for (const raw of activities) {
    const activity = asRecord(raw);
    if (activity === null) continue;
    if (stringField(activity, "after") !== sha) continue;
    times.push(stringField(activity, "timestamp"));
  }
  return latestIso(times);
}

/**
 * Pure resolution of the head-push time from the parsed GraphQL `repository`
 * record plus an independently-derived ref-update timestamp (`refUpdateTime`,
 * from the Repository Activity API — see {@link pickRefUpdateTime}). Returns the
 * LATEST of: the commit's `pushedDate`, the `createdAt` of any matching
 * `HeadRefForcePushedEvent`, and `refUpdateTime`; null when none is available,
 * so callers treat the reaction as unbound (gate stays `reviewing`). Exported
 * for tests.
 *
 * We deliberately do NOT fall back to the commit's `committedDate`. Commit time
 * PRECEDES push time, so a 👍 left for a PRIOR head — in the window between a
 * new commit's local commit-time and its later push — would be newer than the
 * new head's `committedDate` and would falsely bind the unreviewed new head as
 * reviewed-clean. The Activity-API `refUpdateTime` is the real ref-update
 * instant and closes that window: `pushedDate` alone is frequently null for an
 * ordinary fast-forward push (which previously left clean PRs hung to timeout),
 * and the force-push timeline only covers force-moves.
 */
export function resolveHeadPushedAt(
  repository: Record<string, unknown> | null,
  sha: string,
  refUpdateTime: string | null,
): string | null {
  const object = repository === null ? null : recordField(repository, "object");
  const pushedDate = object === null ? null : stringField(object, "pushedDate");

  const candidates: (string | null)[] = [pushedDate, refUpdateTime];
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  const timeline =
    pullRequest === null ? null : recordField(pullRequest, "timelineItems");
  if (timeline !== null) {
    for (const rawNode of arrayField(timeline, "nodes")) {
      const node = asRecord(rawNode);
      if (node === null) continue;
      const afterCommit = recordField(node, "afterCommit");
      const oid = afterCommit === null ? null : stringField(afterCommit, "oid");
      if (oid === sha) candidates.push(stringField(node, "createdAt"));
    }
  }
  return latestIso(candidates);
}

/**
 * The real instant the branch ref was moved to `sha`, from the Repository
 * Activity API filtered to the head ref. Returns null when no such activity is
 * found (retention gap, unavailable) — the caller then leaves the reaction
 * unbound rather than risk a false bind.
 */
async function fetchRefUpdateTime(input: {
  repo: string;
  ref: string;
  sha: string;
  token: string;
}): Promise<string | null> {
  // `time_period=year` (the widest documented window) — the endpoint otherwise
  // defaults to the last day, which would miss the ref update when a build is
  // retried >24h after the head was pushed and leave the clean 👍 unbindable. A
  // head older than a year yields null (gate stays reviewing) rather than a
  // false bind, which is the safe direction.
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/activity?ref=${encodeURIComponent(input.ref)}&per_page=100&time_period=year`;
  const activities: z.infer<typeof RepositoryActivitySchema>[] = [];
  let pages = 0;
  while (url !== null && pages < MAX_ACTIVITY_PAGES) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    // Throw on a contract regression rather than silently reduce a malformed
    // response to "no activity" → a false review timeout. An empty page ([]) is
    // valid and yields null.
    for (const item of parseActivityPage(payload)) activities.push(item);
    url = linkNext;
    pages += 1;
  }
  return pickRefUpdateTime(activities, input.sha);
}

/**
 * The ISO time the PR's head REF became `sha` — the reference point for
 * review-latency and for binding a clean 👍 reaction to the current head.
 * Returns null when it cannot be determined. See {@link resolveHeadPushedAt}
 * for the resolution order (pushedDate → force-push event → activity ref-update
 * time).
 */
export async function fetchHeadPushedAt(input: {
  repo: string;
  sha: string;
  prNumber: number;
  token: string;
}): Promise<string | null> {
  const { owner, name } = splitRepo(input.repo);
  const payload = await graphqlRequest(
    HEAD_REF_UPDATED_AT_QUERY,
    { owner, name, oid: input.sha, number: input.prNumber },
    input.token,
  );
  const payloadRecord = asRecord(payload);
  const data =
    payloadRecord === null ? null : recordField(payloadRecord, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  const headRefName =
    pullRequest === null ? null : stringField(pullRequest, "headRefName");
  const headRepository =
    pullRequest === null ? null : recordField(pullRequest, "headRepository");
  const headRepo =
    headRepository === null
      ? null
      : stringField(headRepository, "nameWithOwner");
  const refUpdateTime =
    headRefName === null
      ? null
      : await fetchRefUpdateTime({
          // A fork PR's head branch lives in the head repository, not the base
          // repo (`input.repo`); query the ref activity there. Same-repo PRs
          // (this repo's git-spice flow) resolve `headRepo === input.repo`;
          // fall back to the base repo only if the head repo is unknown
          // (e.g. a deleted fork), where the lookup yields null anyway.
          repo: headRepo ?? input.repo,
          ref: `refs/heads/${headRefName}`,
          sha: input.sha,
          token: input.token,
        });
  return resolveHeadPushedAt(repository, input.sha, refUpdateTime);
}

/**
 * Whether a commit-less 👍 reaction can be trusted as a review OF the current
 * head: it must have been created at/after the head was pushed. A reaction that
 * predates the head push (a leftover from an earlier commit), or any reaction
 * when the push time is unknown or unparseable, is NOT bound to the head.
 * Exported for tests.
 */
export function reactionBoundToHead(
  reactionCreatedAt: string | null,
  headPushedAt: string | null,
): boolean {
  if (reactionCreatedAt === null || headPushedAt === null) return false;
  const reacted = Date.parse(reactionCreatedAt);
  const pushed = Date.parse(headPushedAt);
  if (!Number.isFinite(reacted) || !Number.isFinite(pushed)) return false;
  return reacted >= pushed;
}
