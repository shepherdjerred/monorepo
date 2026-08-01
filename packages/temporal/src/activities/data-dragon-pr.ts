import { z } from "zod/v4";
import { resolveGitHubAppSlug } from "#lib/github-app-token.ts";
import { runCommand } from "./data-dragon-shell.ts";
import { findDataDragonPr } from "./data-dragon-util.ts";

const OPEN_PR_JSON_FIELDS =
  "title,url,baseRefName,headRefName,isCrossRepository,author";

const OpenPrListSchema = z.array(
  z.object({
    title: z.string(),
    url: z.string(),
    baseRefName: z.string(),
    headRefName: z.string(),
    isCrossRepository: z.boolean(),
    author: z.object({ is_bot: z.boolean(), login: z.string() }),
  }),
);

/**
 * Lists open PRs matching `filterArgs` and returns the URL of the one
 * AUTHENTICATED as this updater's own PR for `version`, or `undefined`. The
 * match (see `findDataDragonPr`) requires the exact generated title, `main`
 * base, a same-repo head of the generated branch shape, and the author being
 * this GitHub App's bot — its slug is resolved live from the numeric
 * `GITHUB_APP_ID` (`resolveGitHubAppSlug`), not a hard-coded login. So a
 * same-title PR from a fork, another base, or a repository collaborator's
 * look-alike branch is never accepted.
 */
async function findAuthenticatedDataDragonPrUrl(
  repoSlug: string,
  filterArgs: string[],
  version: string,
  token: string,
): Promise<string | undefined> {
  const appSlug = await resolveGitHubAppSlug();
  const output = await runCommand(
    [
      "gh",
      "pr",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      ...filterArgs,
      "--json",
      OPEN_PR_JSON_FIELDS,
    ],
    { cwd: "/tmp", env: { GH_TOKEN: token } },
  );
  const prs = OpenPrListSchema.parse(JSON.parse(output));
  return findDataDragonPr(prs, version, appSlug)?.url;
}

/**
 * The URL of an already-open PR bumping to `latestVersion`, or `undefined` if
 * none is open. Prevents the duplicate-PR pattern behind #1827/#1856: a prior
 * run's PR stuck on CI (or unmerged for any reason) — or an activity retry that
 * follows an attempt which already ran `gh pr create` — would otherwise open a
 * second PR for the identical version bump. The broad server-side `--search`
 * term plus an exact client-side title comparison sidesteps GitHub search's
 * fuzzy tokenization of version strings containing dots.
 *
 * Returns the URL (not just a boolean) so the retry path can finish the
 * matched PR's auto-merge setup — an attempt that died between `gh pr create`
 * and `gh pr merge --auto` would otherwise leave the PR stuck with auto-merge
 * never enabled.
 *
 * A plain function (not a Temporal activity) so `updateDataDragon` can call it
 * INSIDE its own retried body — the only place the dedup check is retry-safe.
 */
export function findOpenDataDragonPrUrl(
  repoSlug: string,
  latestVersion: string,
  token: string,
): Promise<string | undefined> {
  return findAuthenticatedDataDragonPrUrl(
    repoSlug,
    ["--search", `${latestVersion} in:title`],
    latestVersion,
    token,
  );
}

/**
 * The URL of the authenticated bot PR open on the exact `branch` head, or
 * `undefined`. Unlike the title `--search` above, `--head` is a direct filter
 * with no search-index lag, so it reliably sees a PR opened moments ago — the
 * property the concurrent-create recovery in `createDataDragonPr` relies on.
 */
export function findOpenPrUrlForHead(
  repoSlug: string,
  branch: string,
  version: string,
  token: string,
): Promise<string | undefined> {
  return findAuthenticatedDataDragonPrUrl(
    repoSlug,
    ["--head", branch],
    version,
    token,
  );
}

export type CreateDataDragonPrArgs = {
  repoSlug: string;
  repoDir: string;
  branch: string;
  base: string;
  title: string;
  body: string;
  version: string;
  token: string;
};

export type CreateDataDragonPrDeps = {
  run?: typeof runCommand;
  findOnHead?: typeof findOpenPrUrlForHead;
};

/**
 * Opens the Data Dragon PR for `branch`, idempotently across concurrent retry
 * attempts. The entry dedup check (`findOpenDataDragonPrUrl`) can't be atomic
 * across the minutes-long clone/install/update window, so two attempts can both
 * pass it and reach here. The deterministic per-version `branch` (see
 * `branchName`) makes GitHub itself the serialization point: it refuses a second
 * open PR for the same head→base, so at most one racing attempt's `gh pr create`
 * succeeds. The loser's create fails; if the authenticated bot PR now exists on
 * this exact head (`findOnHead`, a lag-free `--head` lookup, not the search
 * index), it raced a sibling attempt — return that PR as `recovered` and let the
 * caller finish auto-merge on it rather than erroring the run. Only a create
 * failure with NO bot PR on the head is a genuine failure and rethrows.
 */
export async function createDataDragonPr(
  args: CreateDataDragonPrArgs,
  deps: CreateDataDragonPrDeps = {},
): Promise<{ url: string; recovered: boolean }> {
  const run = deps.run ?? runCommand;
  const findOnHead = deps.findOnHead ?? findOpenPrUrlForHead;
  try {
    const url = await run(
      [
        "gh",
        "pr",
        "create",
        "--repo",
        args.repoSlug,
        "--base",
        args.base,
        "--head",
        args.branch,
        "--title",
        args.title,
        "--body",
        args.body,
      ],
      { cwd: args.repoDir, env: { GH_TOKEN: args.token }, redactOutput: true },
    );
    return { url, recovered: false };
  } catch (error) {
    const existing = await findOnHead(
      args.repoSlug,
      args.branch,
      args.version,
      args.token,
    );
    if (existing === undefined) {
      throw error;
    }
    return { url: existing, recovered: true };
  }
}
