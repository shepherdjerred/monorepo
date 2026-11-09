/**
 * Runs the extended test tier: every `test:extended` task in the Turbo graph,
 * the steps marked `tier: "extended"` in workspaces' ci-tests.json (suites that
 * start PostgreSQL, the Temporal test server, ffmpeg or a game server, or
 * exceed a three-minute p50). Pull-request verification never runs this tier;
 * the committer runs it locally for affected workspaces and the nightly
 * ci-extended-verify pipeline runs it on main.
 *
 * Extra arguments reach Turbo unchanged, so a local run narrows itself:
 *
 *   bun run verify:extended -- --filter='...[origin/main]' --summarize
 *
 * Unlike scripts/verify.ts there are no root checks and no affected-filter
 * logic: the caller's filter (or none, for the nightly) decides the scope.
 */
import { VERIFY_CONCURRENCY, VERIFY_VITEST_MAX_WORKERS } from "./verify.ts";

export const EXTENDED_TASK = "test:extended";

export function extendedTurboCommand(
  forwardedArgs: readonly string[],
): string[] {
  const hasConcurrencyOverride = forwardedArgs.some(
    (argument) =>
      argument === "--concurrency" || argument.startsWith("--concurrency="),
  );
  return [
    "bun",
    "x",
    "--no-install",
    "turbo",
    "run",
    EXTENDED_TASK,
    "--continue",
    ...(hasConcurrencyOverride
      ? []
      : [`--concurrency=${String(VERIFY_CONCURRENCY)}`]),
    ...forwardedArgs,
  ];
}

export function extendedEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return {
    ...environment,
    CI_VITEST_MAX_WORKERS:
      environment["CI_VITEST_MAX_WORKERS"] ?? String(VERIFY_VITEST_MAX_WORKERS),
  };
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
): Promise<number> {
  const forwardedArgs = argv.filter((argument) => argument !== "--");
  const turbo = Bun.spawn(extendedTurboCommand(forwardedArgs), {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: extendedEnvironment(environment),
  });
  return turbo.exited;
}

if (import.meta.main) process.exitCode = await main();
