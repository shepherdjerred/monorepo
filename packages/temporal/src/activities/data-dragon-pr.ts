import { z } from "zod/v4";
import { runCommand } from "./data-dragon-shell.ts";
import { findDataDragonPr } from "./data-dragon-util.ts";

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
 * never enabled. The match is AUTHENTICATED as this updater's own PR (see
 * `findDataDragonPr`): we request the `baseRefName` / `headRefName` /
 * `isCrossRepository` fields so a same-title PR from a fork or another base is
 * rejected rather than auto-merged as if it were the bot's.
 *
 * A plain function (not a Temporal activity) so `updateDataDragon` can call it
 * INSIDE its own retried body — the only place the dedup check is retry-safe.
 */
export async function findOpenDataDragonPrUrl(
  repoSlug: string,
  latestVersion: string,
  token: string,
): Promise<string | undefined> {
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
      `${latestVersion} in:title`,
      "--json",
      "title,url,baseRefName,headRefName,isCrossRepository",
    ],
    { cwd: "/tmp", env: { GH_TOKEN: token } },
  );
  const prs = z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        baseRefName: z.string(),
        headRefName: z.string(),
        isCrossRepository: z.boolean(),
      }),
    )
    .parse(JSON.parse(output));
  return findDataDragonPr(prs, latestVersion)?.url;
}
