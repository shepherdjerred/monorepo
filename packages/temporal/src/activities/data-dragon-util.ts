export function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Unexpected Data Dragon version format: ${version}`);
  }
}

// Shared between the workflow's proxyActivities retry policy
// (workflows/data-dragon.ts) and the activity's final-attempt check below,
// so the two can never drift apart.
export const UPDATE_DATA_DRAGON_MAX_ATTEMPTS = 2;

/**
 * Temporal transparently retries a failed activity attempt; `attempt` is
 * 1-indexed via `Context.current().info.attempt`. Only the final attempt's
 * outcome should feed the `outcome="failed"` metric that backs the paging
 * alert — an earlier attempt that gets retried and later succeeds must not
 * page (PagerDuty #6948).
 */
export function isFinalAttempt(attempt: number, maxAttempts: number): boolean {
  return attempt >= maxAttempts;
}

// The base branch every Data Dragon PR targets, and the prefix of every branch
// the updater generates. Single-sourced here so the create path (branchName)
// and the dedup authentication (findDataDragonPr) can't drift apart.
const DATA_DRAGON_BASE_BRANCH = "main";
const DATA_DRAGON_BRANCH_PREFIX = "chore/scout-data-dragon-";

/**
 * The single branch this updater pushes for `version` —
 * `chore/scout-data-dragon-<version>`. It is DETERMINISTIC (no random suffix)
 * so two concurrent activity attempts (the entry dedup check can't be atomic
 * across the minutes-long clone/install/update window) collide on the same
 * branch at push/create time instead of each opening a fresh randomly-suffixed
 * duplicate PR — the #1827/#1856 bug reopened by the retry window.
 */
export function branchName(version: string): string {
  return `${DATA_DRAGON_BRANCH_PREFIX}${version}`;
}

/**
 * Whether `headRefName` is a branch this updater generated for `version`. Used
 * to authenticate a dedup-matched PR as ours rather than an arbitrary same-title
 * PR. Accepts the current deterministic `chore/scout-data-dragon-<version>`
 * shape (see `branchName`) and, so a still-open PR from a prior run isn't missed
 * during the rollout, the legacy `chore/scout-data-dragon-<version>-<8 hex>`
 * shape. Version is compared literally (its dots are not treated as regex).
 */
export function isDataDragonBranch(
  headRefName: string,
  version: string,
): boolean {
  const deterministic = `${DATA_DRAGON_BRANCH_PREFIX}${version}`;
  if (headRefName === deterministic) {
    return true;
  }
  const legacyPrefix = `${deterministic}-`;
  if (!headRefName.startsWith(legacyPrefix)) {
    return false;
  }
  return /^[0-9a-f]{8}$/.test(headRefName.slice(legacyPrefix.length));
}

/**
 * The exact PR title used both when opening a new Data Dragon PR and when
 * checking for an already-open one (`findOpenDataDragonPrUrl` in
 * data-dragon-pr.ts). A single source keeps the two paths from drifting apart — the dedup check
 * only works because it compares against literally the same string a PR
 * would be created with.
 */
export function dataDragonPrTitle(version: string): string {
  return `chore: update Scout Data Dragon to ${version}`;
}

/**
 * The `author` object `gh pr list --json author` returns. `is_bot` is set by
 * GitHub, not by the PR opener, so it — not the login — is the spoof-proof part
 * of the identity. For a GitHub App's bot actor gh renders the login as
 * `app/<slug>`; the REST / GraphQL form is `<slug>[bot]`.
 */
export type OpenPrAuthor = {
  is_bot: boolean;
  login: string;
};

/**
 * The fields needed to authenticate a candidate open PR as one THIS updater
 * opened. `gh pr list --json` exposes all of them.
 */
export type OpenPrCandidate = {
  title: string;
  url: string;
  baseRefName: string;
  headRefName: string;
  isCrossRepository: boolean;
  author: OpenPrAuthor;
};

/**
 * Reduces the two forms GitHub uses to render a GitHub App's bot actor down to
 * the bare app slug: `gh pr list --json author` yields `app/<slug>`, while the
 * REST / GraphQL author login is `<slug>[bot]`. Both normalize to `<slug>`.
 */
function appSlugFromAuthorLogin(login: string): string {
  const withoutPrefix = login.startsWith("app/")
    ? login.slice("app/".length)
    : login;
  const suffix = "[bot]";
  return withoutPrefix.endsWith(suffix)
    ? withoutPrefix.slice(0, -suffix.length)
    : withoutPrefix;
}

/**
 * Whether `author` is THIS updater's own GitHub App bot. `is_bot` is set by
 * GitHub and cannot be faked by whoever opened the PR, so it is the
 * spoof-proof anchor: a repository collaborator who hand-crafts a same-repo
 * branch of the generated shape with the exact title and base is a `User`
 * (`is_bot: false`) and is rejected here even though every other field matches.
 * The login is then pinned to the app's own slug — resolved live from the
 * stable numeric `GITHUB_APP_ID` (`resolveGitHubAppSlug`), never a hard-coded
 * login string that a rename would silently break — so a *different* bot can't
 * match either.
 */
export function isDataDragonPrAuthor(
  author: OpenPrAuthor,
  appSlug: string,
): boolean {
  return author.is_bot && appSlugFromAuthorLogin(author.login) === appSlug;
}

/**
 * The already-open PR that this updater itself opened for `version`, or
 * `undefined` if none matches. Returns the matched PR (not just a boolean) so
 * the caller can recover its URL to finish auto-merge on the retry path.
 *
 * A genuine match is AUTHENTICATED, not title-only: the caller enables
 * auto-merge on the returned URL and suppresses the real update as
 * `pr-already-open`, so an arbitrary same-title PR — e.g. one a contributor
 * opens from a fork or against a different base — must never be accepted, or
 * the bot would auto-merge someone else's PR. All of these must hold:
 *   - exact generated title (`dataDragonPrTitle`) — GitHub's `--search` is
 *     fuzzy about version dots, so this is the exact client-side check;
 *   - base branch is the one the updater targets (`DATA_DRAGON_BASE_BRANCH`);
 *   - the PR is same-repo, not from a fork (`!isCrossRepository`) — a fork PR
 *     can spoof the title/branch name but not the head repository;
 *   - the head branch matches the generated shape (`isDataDragonBranch`);
 *   - the author is this updater's own GitHub App bot (`isDataDragonPrAuthor`)
 *     — a repository collaborator with push access can craft a same-repo
 *     branch of the generated shape with the exact title and base, so the
 *     bot-identity check (keyed to the app slug for `appSlug`) is what stops
 *     the updater from auto-merging a human's look-alike PR.
 */
export function findDataDragonPr<T extends OpenPrCandidate>(
  openPrs: readonly T[],
  version: string,
  appSlug: string,
): T | undefined {
  const title = dataDragonPrTitle(version);
  return openPrs.find(
    (pr) =>
      pr.title === title &&
      pr.baseRefName === DATA_DRAGON_BASE_BRANCH &&
      !pr.isCrossRepository &&
      isDataDragonBranch(pr.headRefName, version) &&
      isDataDragonPrAuthor(pr.author, appSlug),
  );
}

export function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("GITHUB_APP_ID") ||
    message.includes("GITHUB_APP_INSTALLATION_ID") ||
    message.includes("GITHUB_APP_PRIVATE_KEY")
  ) {
    return "missing-github-app-credentials";
  }
  if (message.includes("GH_TOKEN")) {
    return "missing-gh-token";
  }
  if (message.includes("gh pr create")) {
    return "pr-create-failed";
  }
  if (message.includes("gh pr merge")) {
    return "pr-merge-failed";
  }
  if (message.includes("git push")) {
    return "git-push-failed";
  }
  if (message.includes("update-data-dragon")) {
    return "updater-failed";
  }
  if (message.includes("generate-lane-priors")) {
    return "lane-prior-generation-failed";
  }
  if (message.includes("evaluate-lane-priors")) {
    return "lane-prior-eval-failed";
  }
  if (message.includes("bun install")) {
    return "install-failed";
  }
  if (message.includes("Postal") || message.includes("email configuration")) {
    return "email-failed";
  }
  return "exception";
}

/**
 * Concatenates the `message` of an error and every error in its `.cause`
 * chain. A failed activity surfaces to the workflow as a Temporal
 * `ActivityFailure` whose `.cause` is the original `ApplicationFailure` (both
 * are `Error` subclasses), so the granular message `failureReason`
 * pattern-matches on (e.g. `gh pr create`, `git push`, `update-data-dragon`)
 * lives one or more levels down the chain, not on the top-level failure.
 */
export function collectErrorMessages(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(" | ");
}

/**
 * Resolves the granular `failureReason` for a terminal activity failure as
 * observed at the workflow level. It walks the Temporal failure `.cause` chain
 * first (see {@link collectErrorMessages}) so the reason label — and the
 * `ScoutDataDragonPrAutomationFailed` alert's reason filter — keeps working.
 * An attempt that died without running its own catch (OOM / heartbeat timeout /
 * worker kill) carries no granular command message, so it falls through to
 * `"exception"`, which is the correct generic signal for those outages.
 */
export function resolveTerminalFailureReason(error: unknown): string {
  return failureReason(collectErrorMessages(error));
}
