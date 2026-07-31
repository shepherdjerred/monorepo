import { z } from "zod/v4";
import { runCommand } from "./data-dragon-shell.ts";
import { hasMatchingPrTitle } from "./data-dragon-util.ts";

/**
 * Whether a PR bumping to `latestVersion` is already open. Prevents the
 * duplicate-PR pattern behind #1827/#1856: a prior run's PR stuck on CI (or
 * unmerged for any reason) — or an activity retry that follows an attempt which
 * already ran `gh pr create` — would otherwise open a second PR for the
 * identical version bump. The broad server-side `--search` term plus an exact
 * client-side title comparison sidesteps GitHub search's fuzzy tokenization of
 * version strings containing dots.
 *
 * A plain function (not a Temporal activity) so `updateDataDragon` can call it
 * INSIDE its own retried body — the only place the dedup check is retry-safe.
 */
export async function hasOpenDataDragonPr(
  repoSlug: string,
  latestVersion: string,
  token: string,
): Promise<boolean> {
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
      "title",
    ],
    { cwd: "/tmp", env: { GH_TOKEN: token } },
  );
  const prs = z
    .array(z.object({ title: z.string() }))
    .parse(JSON.parse(output));
  return hasMatchingPrTitle(
    prs.map((pr) => pr.title),
    latestVersion,
  );
}
