import { z } from "zod/v4";
import { runCommand } from "./data-dragon-shell.ts";

export function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Unexpected Data Dragon version format: ${version}`);
  }
}

// Stable, version-independent substring present in every Data Dragon update
// PR title. Used to narrow the `gh pr list` search server-side so the guard
// can never miss the real match behind a `--limit` cap (see listOpenDataDragonPrs).
const DATA_DRAGON_TITLE_MARKER = "Scout Data Dragon";

export function dataDragonBranchPrefix(version: string): string {
  return `chore/scout-data-dragon-${version}-`;
}

export function branchName(version: string, id: string): string {
  return `${dataDragonBranchPrefix(version)}${id.slice(0, 8)}`;
}

export function dataDragonPrTitle(version: string): string {
  return `chore: update Scout Data Dragon to ${version}`;
}

export type OpenPrSummary = {
  url: string;
  title: string;
  headRefName: string;
  isCrossRepository: boolean;
};

/**
 * Guards against the version-check schedule opening a second PR while a
 * prior run's PR for the same target version is still open (e.g. blocked on
 * CI).
 *
 * Matching is deliberately strict. This is a public repository, so any
 * contributor can open a fork PR carrying the predictable title; trusting the
 * title alone would let such a PR wedge the schedule into `pr-already-open`
 * forever, silently leaving Scout data stale. So in addition to the exact
 * title we require a same-repository head branch (fork PRs are
 * `isCrossRepository`) whose name follows the automation's own
 * `chore/scout-data-dragon-<version>-*` convention — a branch only an actor
 * with write access (the app bot or a maintainer) can push.
 */
export function findExistingDataDragonPrUrl(
  openPrs: OpenPrSummary[],
  version: string,
): string | undefined {
  const title = dataDragonPrTitle(version);
  const branchPrefix = dataDragonBranchPrefix(version);
  return openPrs.find(
    (pr) =>
      pr.title === title &&
      !pr.isCrossRepository &&
      pr.headRefName.startsWith(branchPrefix),
  )?.url;
}

const OpenPrListResponse = z.array(
  z.object({
    url: z.string().min(1),
    title: z.string().min(1),
    headRefName: z.string().min(1),
    isCrossRepository: z.boolean(),
  }),
);

/**
 * Lists the currently-open Data Dragon update PRs. The search is narrowed
 * server-side to titles containing DATA_DRAGON_TITLE_MARKER so the fixed
 * `--limit` can never truncate away the real match even when the repo has
 * hundreds of unrelated open PRs; exact-version and provenance matching is
 * then done by findExistingDataDragonPrUrl.
 */
export async function listOpenDataDragonPrs(
  repoSlug: string,
  githubToken: string,
): Promise<OpenPrSummary[]> {
  const output = await runCommand(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `in:title "${DATA_DRAGON_TITLE_MARKER}"`,
      "--json",
      "url,title,headRefName,isCrossRepository",
      "--limit",
      "100",
    ],
    { cwd: "/tmp", env: { GH_TOKEN: githubToken } },
  );
  return OpenPrListResponse.parse(JSON.parse(output));
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
