/**
 * PR-only gate that passes once Greptile has finished reviewing the PR head
 * commit AND every Greptile review comment that still applies to the latest
 * revision has been resolved.
 *
 * Why not just wait for Greptile's own status check?
 *
 *   Greptile's "Greptile Review" check goes green as soon as the review
 *   *completes* — it does not track whether the comments it posted were
 *   addressed (verified live: the check is `completed/success` on PR #1026
 *   while three review comments sit unresolved). So waiting on that check is
 *   useless as a merge gate.
 *
 * What this does instead:
 *
 *   1. Uses Greptile's check-run on the head commit ONLY as a signal that
 *      Greptile has *finished reviewing this revision*. The check is present
 *      even when the review found nothing because `.greptile/config.json` sets
 *      `statusCheck: true`, so it is a reliable "has Greptile reviewed head?"
 *      marker that also covers the clean-review case.
 *   2. Reads the PR's review threads via the GitHub GraphQL API and requires
 *      that every Greptile-authored thread which still applies to the latest
 *      revision (i.e. not `isOutdated`) is `isResolved`.
 *
 * Unresolved comments need a human/agent action (resolve the thread, or push a
 * fix and let Greptile re-review), so once Greptile has reviewed the head we
 * fail fast with an actionable list rather than holding a CI agent for the full
 * timeout. We only *poll* while Greptile is still reviewing the head commit,
 * which is the one genuinely transient state.
 */

type CheckConclusion =
  | "success"
  | "failure"
  | "neutral"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "startup_failure"
  | "stale"
  | null;

/** Greptile's own check-run on the head commit, normalised. */
export type GreptileReviewCheck = {
  found: boolean;
  status: string | null;
  conclusion: CheckConclusion;
  url: string | null;
};

/** A PR review thread, normalised from the GraphQL `reviewThreads` connection. */
export type GreptileThread = {
  authorLogin: string | null;
  isResolved: boolean;
  isOutdated: boolean;
  path: string | null;
  line: number | null;
  url: string | null;
  priority: number | null;
};

export type GateDecision =
  | { state: "waiting"; message: string }
  | { state: "passed"; message: string }
  | { state: "failed"; message: string };

const DEFAULT_REPO = "shepherdjerred/monorepo";
const DEFAULT_GREPTILE_LOGIN = "greptile-apps";
const DEFAULT_CHECK_PATTERN = "greptile";
const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
const DEFAULT_INTERVAL_SECONDS = 30;
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_URL = "https://api.github.com";

const REVIEW_THREADS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      headRefOid
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          line
          comments(first: 1) {
            nodes {
              author { login }
              url
              body
            }
          }
        }
      }
    }
  }
}`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordField(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const value = record[key];
  return isRecord(value) ? value : null;
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function conclusionField(value: string | null): CheckConclusion {
  switch (value) {
    case "success":
    case "failure":
    case "neutral":
    case "cancelled":
    case "skipped":
    case "timed_out":
    case "action_required":
    case "startup_failure":
    case "stale":
      return value;
    default:
      return null;
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${raw}`);
  }
  return parsed;
}

/**
 * Build the RegExp used to match Greptile's check-run name. Guarded so an
 * invalid `GREPTILE_CHECK_PATTERN` fails with an actionable message instead of
 * a bare `SyntaxError`.
 */
export function compileCheckPattern(raw: string | undefined): RegExp {
  const source =
    raw === undefined || raw.trim() === "" ? DEFAULT_CHECK_PATTERN : raw.trim();
  try {
    return new RegExp(source, "iu");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `GREPTILE_CHECK_PATTERN is not a valid regular expression (${source}): ${detail}`,
    );
  }
}

/** Extract the `rel="next"` URL from a GitHub `Link` header, if present. */
export function parseLinkNext(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/u);
    if (match !== null && match[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

/**
 * Parse the Greptile priority badge (P0..P3) from a review comment body.
 * Greptile badges look like:
 *   `<a href="#"><img alt="P2" src="https://…/badges/p2.svg?v=9" …></a>`
 *
 * Returns 0–3 on match, null when the body contains no badge or is null.
 */
export function parseGreptilePriority(body: string | null): number | null {
  if (body === null) return null;
  const altMatch = body.match(/alt="P([0-3])"/iu);
  if (altMatch !== null && altMatch[1] !== undefined) {
    return Number.parseInt(altMatch[1], 10);
  }
  const badgeMatch = body.match(/badges\/p([0-3])\.svg/iu);
  if (badgeMatch !== null && badgeMatch[1] !== undefined) {
    return Number.parseInt(badgeMatch[1], 10);
  }
  return null;
}

function repoFromEnvironment(): string {
  const explicit = process.env["GITHUB_REPOSITORY"];
  if (explicit !== undefined && explicit.trim() !== "") {
    return explicit.trim();
  }

  const buildkiteRepo = process.env["BUILDKITE_REPO"];
  if (buildkiteRepo === undefined || buildkiteRepo.trim() === "") {
    return DEFAULT_REPO;
  }

  const sshMatch = buildkiteRepo.match(
    /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/u,
  );
  if (sshMatch !== null && sshMatch[1] !== undefined) {
    return sshMatch[1];
  }

  const httpsMatch = buildkiteRepo.match(
    /github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/u,
  );
  if (httpsMatch !== null && httpsMatch[1] !== undefined) {
    return httpsMatch[1];
  }

  return DEFAULT_REPO;
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    owner === "" ||
    name === ""
  ) {
    throw new Error(`Expected repository in owner/name form, got ${repo}`);
  }
  return { owner, name };
}

type ReviewState = "reviewing" | "reviewed" | "errored";

/**
 * Classify Greptile's check-run into a coarse review state:
 * - `reviewing`: Greptile has not finished reviewing this commit yet.
 * - `errored`: Greptile's review job failed/was cancelled (thread state cannot
 *   be trusted; the reviewer needs to re-trigger it).
 * - `reviewed`: Greptile finished reviewing this commit.
 */
function classifyReviewCheck(check: GreptileReviewCheck): ReviewState {
  if (!check.found || check.status !== "completed") {
    return "reviewing";
  }
  switch (check.conclusion) {
    case "failure":
    case "cancelled":
    case "timed_out":
    case "startup_failure":
      return "errored";
    default:
      return "reviewed";
  }
}

function isBlocking(
  thread: GreptileThread,
  greptileLogin: string,
  maxBlockingPriority: number,
): boolean {
  return (
    thread.authorLogin === greptileLogin &&
    !thread.isResolved &&
    !thread.isOutdated &&
    thread.priority !== null &&
    thread.priority <= maxBlockingPriority
  );
}

function priorityLabel(priority: number | null): string {
  return priority === null ? "P?" : `P${String(priority)}`;
}

function describeThread(thread: GreptileThread): string {
  const location =
    thread.path === null
      ? "(general comment)"
      : thread.line === null
        ? thread.path
        : `${thread.path}:${String(thread.line)}`;
  const url = thread.url === null ? "" : ` — ${thread.url}`;
  return `${location}${url}`;
}

/**
 * A reason Greptile decided not to review the PR. Greptile posts an
 * issue-level comment marked with `<!-- greptile-status -->` instead of
 * creating its usual check-run in two known cases:
 *
 *   - `no-reviewable-files`: every file in the diff matched the ignore
 *     patterns defined in `.greptile/config.json`, so nothing was left to
 *     review.
 *   - `too-many-files`: the diff exceeded Greptile's file-count limit
 *     (currently 500 files; observed phrase: "Too many files changed for
 *     review. (`N files found`, `500 file limit`)").
 *
 * In either case there is no check-run to wait for, so the gate would
 * otherwise time out after 1200s. We must detect the skip marker on the
 * issue comments and short-circuit.
 */
export type GreptileSkipReason = "no-reviewable-files" | "too-many-files";

/**
 * Detect a Greptile skip-review status comment and return the structured
 * reason, or `null` if the body is not a Greptile skip notice.
 *
 * The marker is the HTML comment `<!-- greptile-status -->` followed (on the
 * same or next line) by a phrase identifying the specific skip reason.
 */
export function parseGreptileSkippedReview(
  body: string | null,
): GreptileSkipReason | null {
  if (body === null) return null;
  if (!body.includes("<!-- greptile-status -->")) return null;
  if (body.includes("No reviewable files")) return "no-reviewable-files";
  if (body.includes("Too many files changed for review")) {
    return "too-many-files";
  }
  return null;
}

/**
 * Pure decision: given the head commit, Greptile's review-check state, the
 * PR's review threads, and whether Greptile explicitly decided to skip the
 * review, decide whether the gate should pass, keep waiting, or fail.
 *
 * `maxBlockingPriority` controls which priority levels are blocking:
 * a thread blocks when its priority (0=most severe…3=least severe) is ≤ this
 * threshold. Threads with no priority badge are never blocking.
 *
 * `skippedReview` is non-null when Greptile posted a skip-review status
 * comment on the issue (no reviewable files, or too many files for review).
 * In that case the check-run wait is skipped (Greptile never creates one when
 * it decides not to review), but thread resolution is still evaluated —
 * earlier commits on the same PR may have produced unresolved Greptile
 * threads that GitHub does not automatically mark as outdated when only
 * ignored / overflow files change.
 */
export function evaluateGate(input: {
  head: string;
  reviewCheck: GreptileReviewCheck;
  threads: readonly GreptileThread[];
  greptileLogin: string;
  maxBlockingPriority: number;
  skippedReview?: GreptileSkipReason | null;
}): GateDecision {
  // When Greptile skips review entirely, there is no check-run to wait for.
  // We bypass the check-run gate and fall through to thread evaluation, which
  // still catches unresolved threads left by Greptile on earlier commits of
  // the same PR.
  const skippedReview = input.skippedReview ?? null;
  const reviewState =
    skippedReview !== null
      ? "reviewed"
      : classifyReviewCheck(input.reviewCheck);

  if (reviewState === "reviewing") {
    const status = !input.reviewCheck.found
      ? "not started"
      : (input.reviewCheck.status ?? "pending");
    return {
      state: "waiting",
      message: `Waiting for Greptile to finish reviewing ${input.head} (review check: ${status}).`,
    };
  }

  if (reviewState === "errored") {
    return {
      state: "failed",
      message:
        `Greptile's review of ${input.head} did not complete successfully ` +
        `(conclusion=${input.reviewCheck.conclusion ?? "unknown"}). ` +
        `Re-trigger Greptile, then re-run this step.`,
    };
  }

  const blocking = input.threads.filter((thread) =>
    isBlocking(thread, input.greptileLogin, input.maxBlockingPriority),
  );

  if (blocking.length === 0) {
    const prefix =
      skippedReview === "no-reviewable-files"
        ? `Greptile reported no reviewable files for ${input.head} after applying ignore patterns`
        : skippedReview === "too-many-files"
          ? `Greptile skipped review for ${input.head}: too many files changed (over the 500-file limit)`
          : `Greptile reviewed ${input.head}`;
    return {
      state: "passed",
      message:
        `${prefix}; no unresolved Greptile comments at priority ` +
        `P${String(input.maxBlockingPriority)} or more severe remain.`,
    };
  }

  const list = blocking
    .map(
      (thread) =>
        `  - ${priorityLabel(thread.priority)} ${describeThread(thread)}`,
    )
    .join("\n");
  return {
    state: "failed",
    message:
      `${String(blocking.length)} unresolved Greptile comment(s) on ${input.head}:\n${list}\n` +
      `Resolve each thread (or push a fix and let Greptile re-review), then re-run this step.`,
  };
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
}

async function getJsonWithLink(
  url: string,
  token: string,
): Promise<{ payload: unknown; linkNext: string | null }> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub API request failed with ${String(response.status)} ${response.statusText}: ${body}`,
    );
  }
  const payload: unknown = await response.json();
  return { payload, linkNext: parseLinkNext(response.headers.get("link")) };
}

async function graphqlRequest(
  query: string,
  variables: Record<string, unknown>,
  token: string,
): Promise<unknown> {
  const response = await fetch(`${GITHUB_API_URL}/graphql`, {
    method: "POST",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `GitHub GraphQL request failed with ${String(response.status)} ${response.statusText}: ${body}`,
    );
  }
  const payload: unknown = await response.json();
  if (isRecord(payload) && payload["errors"] !== undefined) {
    throw new Error(
      `GitHub GraphQL returned errors: ${JSON.stringify(payload["errors"])}`,
    );
  }
  return payload;
}

type CheckRunRecord = {
  status: string;
  conclusion: CheckConclusion;
  url: string | null;
  updatedAt: string | null;
};

function parseMatchingCheckRuns(
  payload: unknown,
  pattern: RegExp,
): CheckRunRecord[] {
  if (!isRecord(payload)) {
    throw new Error("GitHub check-runs response was not an object");
  }
  const checkRuns = arrayField(payload, "check_runs");
  const matches: CheckRunRecord[] = [];
  for (const item of checkRuns) {
    if (!isRecord(item)) continue;
    const name = stringField(item, "name");
    const status = stringField(item, "status");
    if (name === null || status === null || !pattern.test(name)) continue;
    matches.push({
      status,
      conclusion: conclusionField(stringField(item, "conclusion")),
      url: stringField(item, "html_url"),
      updatedAt:
        stringField(item, "completed_at") ??
        stringField(item, "started_at") ??
        stringField(item, "created_at"),
    });
  }
  return matches;
}

/** Pick the most recently updated check-run (the latest review attempt). */
function pickLatestCheck(
  checks: readonly CheckRunRecord[],
): CheckRunRecord | null {
  let chosen: CheckRunRecord | null = null;
  let chosenScore = Number.NEGATIVE_INFINITY;
  for (const check of checks) {
    const parsed = Date.parse(check.updatedAt ?? "");
    const score = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    if (chosen === null || score >= chosenScore) {
      chosen = check;
      chosenScore = score;
    }
  }
  return chosen;
}

async function fetchGreptileReviewCheck(input: {
  repo: string;
  head: string;
  token: string;
  pattern: RegExp;
}): Promise<GreptileReviewCheck> {
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/commits/${encodeURIComponent(input.head)}/check-runs?per_page=100`;
  const matches: CheckRunRecord[] = [];
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    matches.push(...parseMatchingCheckRuns(payload, input.pattern));
    url = linkNext;
  }
  const chosen = pickLatestCheck(matches);
  if (chosen === null) {
    return { found: false, status: null, conclusion: null, url: null };
  }
  return {
    found: true,
    status: chosen.status,
    conclusion: chosen.conclusion,
    url: chosen.url,
  };
}

type ThreadPage = {
  headRefOid: string | null;
  threads: GreptileThread[];
  hasNextPage: boolean;
  endCursor: string | null;
};

function parseThreadPage(payload: unknown): ThreadPage {
  if (!isRecord(payload)) {
    throw new Error("GitHub GraphQL response was not an object");
  }
  const data = recordField(payload, "data");
  const repository = data === null ? null : recordField(data, "repository");
  const pullRequest =
    repository === null ? null : recordField(repository, "pullRequest");
  if (pullRequest === null) {
    throw new Error(
      "GitHub GraphQL response did not include repository.pullRequest",
    );
  }
  const reviewThreads = recordField(pullRequest, "reviewThreads");
  if (reviewThreads === null) {
    throw new Error("GitHub GraphQL response did not include reviewThreads");
  }

  const threads: GreptileThread[] = [];
  for (const node of arrayField(reviewThreads, "nodes")) {
    if (!isRecord(node)) continue;
    const comments = recordField(node, "comments");
    const commentNodes = comments === null ? [] : arrayField(comments, "nodes");
    const firstComment: unknown = commentNodes[0];
    let authorLogin: string | null = null;
    let url: string | null = null;
    let priority: number | null = null;
    if (isRecord(firstComment)) {
      const author = recordField(firstComment, "author");
      authorLogin = author === null ? null : stringField(author, "login");
      url = stringField(firstComment, "url");
      priority = parseGreptilePriority(stringField(firstComment, "body"));
    }
    threads.push({
      authorLogin,
      isResolved: boolField(node, "isResolved"),
      isOutdated: boolField(node, "isOutdated"),
      path: stringField(node, "path"),
      line: numberField(node, "line"),
      url,
      priority,
    });
  }

  const pageInfo = recordField(reviewThreads, "pageInfo");
  return {
    headRefOid: stringField(pullRequest, "headRefOid"),
    threads,
    hasNextPage: pageInfo !== null && boolField(pageInfo, "hasNextPage"),
    endCursor: pageInfo === null ? null : stringField(pageInfo, "endCursor"),
  };
}

async function fetchGreptileThreads(input: {
  owner: string;
  name: string;
  number: number;
  token: string;
}): Promise<{ threads: GreptileThread[]; headRefOid: string | null }> {
  const threads: GreptileThread[] = [];
  let headRefOid: string | null = null;
  let cursor: string | null = null;
  for (;;) {
    const payload = await graphqlRequest(
      REVIEW_THREADS_QUERY,
      {
        owner: input.owner,
        name: input.name,
        number: input.number,
        cursor,
      },
      input.token,
    );
    const page = parseThreadPage(payload);
    if (page.headRefOid !== null) headRefOid = page.headRefOid;
    threads.push(...page.threads);
    if (!page.hasNextPage || page.endCursor === null) break;
    cursor = page.endCursor;
  }
  return { threads, headRefOid };
}

/**
 * Check whether Greptile has posted a skip-review status comment on the PR
 * issue.  Greptile posts one of these instead of creating a check-run when it
 * decides not to review the diff — either because every file matches the
 * `.greptile/config.json` ignore patterns, or because the diff exceeded
 * Greptile's 500-file review limit.  Returns the structured skip reason, or
 * `null` if no skip comment was found.
 */
async function fetchGreptileSkippedReview(input: {
  repo: string;
  number: number;
  greptileLogin: string;
  token: string;
}): Promise<GreptileSkipReason | null> {
  let url: string | null =
    `${GITHUB_API_URL}/repos/${input.repo}/issues/${String(input.number)}/comments?per_page=100`;
  while (url !== null) {
    const { payload, linkNext } = await getJsonWithLink(url, input.token);
    // The REST response for /issues/:number/comments is a top-level array.
    const commentArray = Array.isArray(payload) ? payload : [];
    for (const item of commentArray) {
      if (!isRecord(item)) continue;
      const userRecord = recordField(item, "user");
      const login =
        userRecord === null ? null : stringField(userRecord, "login");
      if (login !== input.greptileLogin) continue;
      const reason = parseGreptileSkippedReview(stringField(item, "body"));
      if (reason !== null) return reason;
    }
    url = linkNext;
  }
  return null;
}

async function waitForGreptile(): Promise<void> {
  const pullRequest = process.env["BUILDKITE_PULL_REQUEST"];
  if (
    pullRequest === undefined ||
    pullRequest === "" ||
    pullRequest === "false"
  ) {
    console.log("Not a Buildkite pull request build; skipping Greptile gate.");
    return;
  }
  const number = Number.parseInt(pullRequest, 10);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(
      `BUILDKITE_PULL_REQUEST must be a positive integer, got ${pullRequest}`,
    );
  }

  const token = process.env["GH_TOKEN"];
  if (token === undefined || token.trim() === "") {
    throw new Error("GH_TOKEN is required to query GitHub review threads");
  }

  const commit = process.env["BUILDKITE_COMMIT"];
  if (commit === undefined || commit.trim() === "") {
    throw new Error("BUILDKITE_COMMIT is required to identify the PR head");
  }
  const head = commit.trim();

  const repo = repoFromEnvironment();
  const { owner, name } = splitRepo(repo);
  const greptileLogin =
    process.env["GREPTILE_AUTHOR_LOGIN"]?.trim() ?? DEFAULT_GREPTILE_LOGIN;
  const pattern = compileCheckPattern(process.env["GREPTILE_CHECK_PATTERN"]);
  const timeoutSeconds = parsePositiveIntegerEnv(
    "GREPTILE_WAIT_TIMEOUT_SECONDS",
    DEFAULT_TIMEOUT_SECONDS,
  );
  const intervalSeconds = parsePositiveIntegerEnv(
    "GREPTILE_WAIT_INTERVAL_SECONDS",
    DEFAULT_INTERVAL_SECONDS,
  );

  const maxBlockingPriorityRaw = process.env["GREPTILE_MAX_BLOCKING_PRIORITY"];
  const maxBlockingPriority = (() => {
    if (
      maxBlockingPriorityRaw === undefined ||
      maxBlockingPriorityRaw.trim() === ""
    ) {
      return 3;
    }
    const parsed = Number.parseInt(maxBlockingPriorityRaw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
      throw new Error(
        `GREPTILE_MAX_BLOCKING_PRIORITY must be an integer in [0,3], got ${maxBlockingPriorityRaw}`,
      );
    }
    return parsed;
  })();

  const deadline = Date.now() + timeoutSeconds * 1000;
  let warnedMismatch = false;

  while (Date.now() <= deadline) {
    const [reviewCheck, threadResult] = await Promise.all([
      fetchGreptileReviewCheck({ repo, head, token, pattern }),
      fetchGreptileThreads({ owner, name, number, token }),
    ]);

    // Only check for a Greptile skip-review comment when Greptile has not
    // created a check-run for this head.  If a check-run exists, Greptile IS
    // reviewing (or has reviewed) the diff, so the issue-comment path is
    // irrelevant — avoid an unnecessary paginated REST call on every poll.
    const skippedReview = reviewCheck.found
      ? null
      : await fetchGreptileSkippedReview({
          repo,
          number,
          greptileLogin,
          token,
        });

    if (
      !warnedMismatch &&
      threadResult.headRefOid !== null &&
      threadResult.headRefOid !== head
    ) {
      console.warn(
        `PR #${String(number)} head is now ${threadResult.headRefOid}, but this build is for ${head}; evaluating ${head}.`,
      );
      warnedMismatch = true;
    }

    const decision = evaluateGate({
      head,
      reviewCheck,
      threads: threadResult.threads,
      greptileLogin,
      maxBlockingPriority,
      skippedReview,
    });

    if (decision.state === "passed") {
      console.log(decision.message);
      return;
    }
    if (decision.state === "failed") {
      throw new Error(decision.message);
    }

    console.log(decision.message);
    await Bun.sleep(intervalSeconds * 1000);
  }

  throw new Error(
    `Timed out after ${String(timeoutSeconds)}s waiting for Greptile to finish reviewing ${repo}@${head}. ` +
      `If Greptile is enabled, confirm its check name matches GREPTILE_CHECK_PATTERN (/${pattern.source}/i) ` +
      `and that it authors threads as ${greptileLogin} (override with GREPTILE_AUTHOR_LOGIN).`,
  );
}

if (import.meta.main) {
  try {
    await waitForGreptile();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
