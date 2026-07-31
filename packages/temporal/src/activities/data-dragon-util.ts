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

export function branchName(version: string, id: string): string {
  return `chore/scout-data-dragon-${version}-${id.slice(0, 8)}`;
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
 * The already-open PR (by exact title) that targets this Data Dragon version,
 * or `undefined` if none matches. GitHub's `--search` is fuzzy (its tokenizer
 * doesn't treat a version string's dots specially), so callers should search
 * broadly on the server side and use this for an exact client-side match.
 * Returns the matched PR (not just a boolean) so the caller can recover its
 * URL to finish auto-merge on the retry path.
 */
export function findDataDragonPr<T extends { title: string }>(
  openPrs: readonly T[],
  version: string,
): T | undefined {
  const title = dataDragonPrTitle(version);
  return openPrs.find((pr) => pr.title === title);
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
