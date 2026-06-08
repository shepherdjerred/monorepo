/**
 * GitHub layer for `toolkit deployed` (optional enrichment via `gh`).
 *
 * Answers "which PR merged this commit?" and "is a version-bump PR still open?"
 * Degrades silently — a missing/unauthenticated `gh` just drops these fields.
 */
import { z } from "zod";
import { runGhCommand } from "#lib/github/client.ts";

const PrSchema = z.object({
  number: z.number(),
  state: z.string(),
  url: z.string(),
  title: z.string().optional(),
});

const PrListSchema = z.array(PrSchema);

export type PrInfo = { number: number; state: string; url: string };

/** The PR that introduced a commit (best-effort search by SHA). */
export async function prForCommit(sha: string): Promise<PrInfo | null> {
  const res = await runGhCommand(
    [
      "pr",
      "list",
      "--search",
      sha,
      "--state",
      "all",
      "--json",
      "number,state,url,title",
    ],
    PrListSchema,
  );
  if (!res.success || res.data == null || res.data.length === 0) {
    return null;
  }
  const pr = res.data[0];
  if (pr == null) {
    return null;
  }
  return { number: pr.number, state: pr.state, url: pr.url };
}

/** Open "bump image versions" PRs — a non-empty list means a release is in flight. */
export async function openBumpPrs(): Promise<PrInfo[]> {
  const res = await runGhCommand(
    [
      "pr",
      "list",
      "--search",
      "bump image versions in:title",
      "--state",
      "open",
      "--json",
      "number,state,url,title",
    ],
    PrListSchema,
  );
  if (!res.success || res.data == null) {
    return [];
  }
  return res.data.map((pr) => ({
    number: pr.number,
    state: pr.state,
    url: pr.url,
  }));
}
