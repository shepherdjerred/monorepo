/**
 * Local Layer-2 test harness for the scout-season-refresh activity.
 *
 * Imports `runScoutSeasonRefresh` directly, runs it against a checkout of
 * the monorepo, and either prints the diff to stdout (DRY_RUN=1) or opens
 * a real PR (DRY_RUN=0).
 *
 * Usage:
 *   # Pure dry-run against a fresh clone (slow: shallow clone + claude -p):
 *   op run --env-file=.env.season-refresh -- DRY_RUN=1 bun run scripts/run-scout-season-refresh-local.ts
 *
 *   # Faster iteration: point at an existing checkout (skips clone):
 *   op run --env-file=.env.season-refresh -- DRY_RUN=1 \
 *     bun run scripts/run-scout-season-refresh-local.ts --repo=/tmp/some-monorepo-checkout
 *
 *   # Cheap-model iteration:
 *   op run --env-file=.env.season-refresh -- DRY_RUN=1 --haiku ...
 *
 *   # Real PR run (use a throwaway branch — workflow opens PR and exits):
 *   op run --env-file=.env.season-refresh -- bun run scripts/run-scout-season-refresh-local.ts
 *
 * Notes:
 *   - This bypasses Temporal entirely. No worker bundle, no schedule. The
 *     activity body is just Bun.spawn + git/gh commands.
 *   - When using --repo=PATH, the harness assumes PATH is a clean checkout
 *     of the monorepo. The activity mutates files there in-place; reset
 *     between runs with `git checkout -- packages/scout-for-lol/.../seasons*`.
 *   - DRY_RUN=1 writes the resulting diff to /tmp/scout-season-refresh-<uuid>.diff.
 */
import { scoutSeasonRefreshActivities } from "#activities/scout-season-refresh.ts";

type Args = {
  repo: string | undefined;
  model: string | undefined;
  maxTurns: number | undefined;
};

function parseArgs(argv: readonly string[]): Args {
  let repo: string | undefined;
  let model: string | undefined;
  let maxTurns: number | undefined;
  for (const arg of argv) {
    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
    } else if (arg === "--haiku") {
      model = "claude-haiku-4-5-20251001";
    } else if (arg.startsWith("--model=")) {
      model = arg.slice("--model=".length);
    } else if (arg.startsWith("--max-turns=")) {
      maxTurns = Number(arg.slice("--max-turns=".length));
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return { repo, model, maxTurns };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Bun.env["DRY_RUN"] === "1";

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Starting local scout-season-refresh run",
      dryRun,
      repo: args.repo ?? "(clone fresh)",
      model: args.model ?? "(default)",
      maxTurns: args.maxTurns ?? "(default)",
    }),
  );

  const start = Date.now();
  const input: Parameters<
    typeof scoutSeasonRefreshActivities.runScoutSeasonRefresh
  >[0] = { dryRun };
  if (args.repo !== undefined) input.workdir = args.repo;
  if (args.model !== undefined) input.model = args.model;
  if (args.maxTurns !== undefined) input.maxTurns = args.maxTurns;
  const result =
    await scoutSeasonRefreshActivities.runScoutSeasonRefresh(input);
  const elapsedSeconds = (Date.now() - start) / 1000;

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Local scout-season-refresh run complete",
      outcome: result.outcome,
      reason: result.reason,
      changedFiles: result.changedFiles,
      branchName: result.branchName,
      prUrl: result.prUrl,
      durationSeconds: result.durationSeconds,
      costUsd: result.costUsd,
      numTurns: result.numTurns,
      wallSeconds: elapsedSeconds,
    }),
  );

  if (result.diff !== undefined && result.diff.length > 0) {
    process.stdout.write("\n--- DIFF ---\n");
    process.stdout.write(result.diff);
    if (!result.diff.endsWith("\n")) process.stdout.write("\n");
  }
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
