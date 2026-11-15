import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Who may read the participant crawl.
 *
 * Crawled matches are identified data about players who never joined a Scout
 * server, so reading them is a product decision per surface, not a default.
 * The `all` population is a branded value only `all-population.ts` produces,
 * so importing that module is the permission; this pins exactly which
 * modules hold it. Dares, progression, community, consumer and guild-scope
 * readers are deliberately absent and keep the `tracked` default.
 *
 * Adding a module here is the review point: say in the PR why that surface
 * should see crawled players.
 */
const ALLOWED_IMPORTERS = new Set([
  // Global ScoutQL: a `servers: null` Explore turn reads `all`.
  "explore/tools/server-scope.ts",
  // Coverage of an untracked player before importing their history.
  "explore/tools/riot-player-tools.ts",
  // The on-demand import's known-id check: a crawled game is not refetched.
  "league/explore-history/import.ts",
  // The Explore match router and its match cards.
  "trpc/router/explore/explore-match.router.ts",
  "explore-match/match-view.ts",
  // review_match's "no stored match document" answer for a crawled game.
  "explore/analysis/crawled-match.ts",
]);

const SRC = path.resolve(import.meta.dirname, "../../..");
const IMPORT =
  /from\s+["']#src\/reports\/duckdb\/lake\/all-population\.ts["']/u;

async function importers(): Promise<string[]> {
  const found: string[] = [];
  for await (const relative of new Bun.Glob("**/*.ts").scan({ cwd: SRC })) {
    if (relative.endsWith(".test.ts")) continue;
    const text = await Bun.file(path.join(SRC, relative)).text();
    if (IMPORT.test(text)) found.push(relative);
  }
  return found.toSorted();
}

describe("the all population", () => {
  test("is imported only by the allow-listed global-scope readers", async () => {
    expect(await importers()).toEqual([...ALLOWED_IMPORTERS].toSorted());
  });

  test("is minted only by all-population.ts", async () => {
    const minters: string[] = [];
    for await (const relative of new Bun.Glob("**/*.ts").scan({ cwd: SRC })) {
      if (relative.endsWith(".test.ts")) continue;
      const text = await Bun.file(path.join(SRC, relative)).text();
      if (/AllPopulationSchema\.(?:safe)?[pP]arse/u.test(text)) {
        minters.push(relative);
      }
    }
    expect(minters).toEqual(["reports/duckdb/lake/all-population.ts"]);
  });
});
