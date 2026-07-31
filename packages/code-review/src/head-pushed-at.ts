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
  // `after` is null for activities with no resulting commit (e.g. a
  // branch_deletion). Such rows never match the head SHA and are ignored by
  // pickRefUpdateTime, but the value is legitimately null so the schema must
  // permit it (a missing key, by contrast, is still a contract regression).
  after: z.string().nullable(),
  timestamp: z.string(),
});

// The PR's head repository. Present as `{ nameWithOwner }` for same-repo and
// fork PRs; `null` only when the head repo is gone (e.g. a deleted fork). A
// present-but-malformed value is a contract regression and must throw (so it is
// not silently reduced to "unknown head repo" → a wrong-repo activity lookup →
// a false review timeout).
const HeadRepositorySchema = z.object({ nameWithOwner: z.string() }).nullable();

// The full HEAD_REF_OID_QUERY response. Every level is required: a missing/
// wrong-typed `repository`/`pullRequest`/`headRefOid` is a contract regression
// that must throw, not collapse to null (which the post-activity re-check would
// misread as a head advance → the wait loop refetches until its timeout).
const HeadRefOidResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({ headRefOid: z.string() }),
    }),
  }),
});

const HEAD_REF_UPDATED_AT_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefName
      headRefOid
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

const HEAD_REF_OID_QUERY = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { headRefOid }
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
 * Validate one Repository-Activity API page, THROWING on a contract regression
 * (a non-array payload or an item missing `after`/`timestamp`) rather than
 * silently reducing it to "no activity". Exported for tests.
 */
export function parseActivityPage(
  payload: unknown,
): z.infer<typeof RepositoryActivitySchema>[] {
  return z.array(RepositoryActivitySchema).parse(payload);
}

/**
 * Validate the PR's `headRepository` GraphQL field, returning `nameWithOwner`
 * (or null when the head repo is gone) and THROWING on a malformed shape.
 * Exported for tests.
 */
export function parseHeadRepo(value: unknown): string | null {
  return HeadRepositorySchema.parse(value)?.nameWithOwner ?? null;
}

/**
 * Extract `headRefOid` from a HEAD_REF_OID_QUERY response, THROWING on a
 * malformed shape rather than collapsing it to null. Exported for tests.
 */
export function parseHeadRefOid(payload: unknown): string {
  return HeadRefOidResponseSchema.parse(payload).data.repository.pullRequest
    .headRefOid;
}

/**
 * Pure: the latest Repository-Activity `timestamp` whose `after` SHA equals the
 * head — the real instant the ref was moved to this commit (a `push`,
 * `force_push`, or `branch_creation`). Exported for tests.
 */
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
 * LATEST of `refUpdateTime` and the `createdAt` of any matching
 * `HeadRefForcePushedEvent` — both true ref-update instants — or null when
 * neither is available, so callers treat the reaction as unbound (gate stays
 * `reviewing`). Exported for tests.
 *
 * We deliberately use ONLY ref-update signals — never the commit's `pushedDate`
 * or `committedDate`. Both can PRECEDE the moment the commit became this PR's
 * head (`pushedDate` for a fast-forward of the ref to a pre-existing commit;
 * `committedDate` always), so a stale 👍 left for a PRIOR head could bind the
 * unreviewed new head as reviewed-clean. When no ref-update signal is available
 * (e.g. the Activity event is outside the query window or not yet exposed) we
 * return null and stay unbound rather than fall back to an unreliable timestamp
 * — correct-but-unmeasured beats a false completion.
 */
export function resolveHeadPushedAt(
  repository: Record<string, unknown> | null,
  sha: string,
  refUpdateTime: string | null,
): string | null {
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  // If the PR advanced past `sha` (a stale build, or a list/query race in the
  // collector), the Activity lookup could still find that sha's historical ref
  // update and a newer 👍 for the CURRENT head would be misattributed to the old
  // sha. Only resolve a head-push time while `sha` is still the PR head;
  // otherwise (mismatch, or a null/failed snapshot) leave it unbound.
  const headRefOid =
    pullRequest === null ? null : stringField(pullRequest, "headRefOid");
  if (headRefOid !== sha) return null;

  const candidates: (string | null)[] = [refUpdateTime];
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
 * The PR's current head-commit OID. Throws on a malformed response (see
 * {@link parseHeadRefOid}) so an API contract failure surfaces as an actionable
 * error rather than a null the caller misreads as a head advance.
 */
async function fetchHeadRefOid(input: {
  repo: string;
  prNumber: number;
  token: string;
}): Promise<string> {
  const { owner, name } = splitRepo(input.repo);
  const payload = await graphqlRequest(
    HEAD_REF_OID_QUERY,
    { owner, name, number: input.prNumber },
    input.token,
  );
  return parseHeadRefOid(payload);
}

/**
 * The ISO time the PR's head REF became `sha` — the reference point for
 * review-latency and for binding a clean 👍 reaction to the current head.
 * Returns null when it cannot be determined. See {@link resolveHeadPushedAt}
 * for the resolution order (force-push event → activity ref-update time), which
 * also requires `sha` to be the PR head.
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
    { owner, name, number: input.prNumber },
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
  const headRepo =
    pullRequest === null ? null : parseHeadRepo(pullRequest["headRepository"]);
  const refUpdateTime =
    headRefName === null || headRepo === null
      ? null
      : await fetchRefUpdateTime({
          // The head branch lives in the HEAD repository — the base repo for a
          // same-repo PR (native stack, legacy git-spice, or stateless bot), or
          // the fork for a fork PR. Never fall back to the base repo when the
          // head repo is unknown
          // (a deleted fork): a same-named branch there could carry an
          // unrelated activity whose `after` coincides with this SHA and
          // falsely bind the reaction. Unknown head repo → leave unbound.
          repo: headRepo,
          ref: `refs/heads/${headRefName}`,
          sha: input.sha,
          token: input.token,
        });
  // Re-read the head AFTER the activity snapshot (the GraphQL headRefOid above
  // was taken BEFORE the REST call): if the PR advanced during the activity
  // fetch, the timestamp we found is for the now-old sha and a later 👍 for the
  // new head must not be attributed to it. Leave unbound on any advance.
  const currentHeadRefOid = await fetchHeadRefOid({
    repo: input.repo,
    prNumber: input.prNumber,
    token: input.token,
  });
  if (currentHeadRefOid !== input.sha) return null;
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
