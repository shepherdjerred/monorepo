/**
 * Replay Explore cases against a pinned stage dataset.
 *
 * This file imports almost nothing on purpose. The agent reads `DATABASE_URL`
 * and `REPORT_LAKE_DIR` through module singletons that bind on first import,
 * so the only moment the environment can be checked is before the harness is
 * loaded at all. Everything after the guard is a dynamic import.
 *
 * That inverts the rule in `database/design-audit-seed.ts` ("never inherit
 * REPORT_LAKE_DIR"): here we refuse to start *unless* it points at the pinned
 * dataset, so a stray value can neither be queried nor deleted.
 *
 * Like the other model-backed evals in this package, this calls a live model
 * and is a manual gate, never CI.
 */

import path from "node:path";
import {
  USAGE,
  defaultDatasetPinPath,
  parseReplayArgs,
} from "#src/explore/replay/cli.ts";
import {
  StageDatasetPinSchema,
  replayEnvironmentIssues,
  type StageDatasetPin,
} from "#src/explore/replay/dataset.ts";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

async function loadPin(pinPath: string): Promise<StageDatasetPin> {
  const file = Bun.file(pinPath);
  if (!(await file.exists())) {
    fail(
      [
        `No dataset pin at ${pinPath}.`,
        "",
        "Create one by pulling both halves, lake first:",
        "  bun run --filter='./packages/scout-for-lol' dev:lake-pull -- --stage <stage>",
        "  bun run --filter='./packages/scout-for-lol' dev:db-pull -- --stage <stage>",
      ].join("\n"),
    );
  }
  const raw: unknown = await file.json();
  return StageDatasetPinSchema.parse(raw);
}

/**
 * The lake directory the backend will actually open.
 *
 * `REPORT_LAKE_DIR` is read as a plain string and resolved against the
 * backend's own cwd, so a relative value means something different here than
 * it will there. Resolving it the same way is what makes the comparison
 * against the pin meaningful rather than decorative.
 */
function resolvedLakeDir(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const configured = environment["REPORT_LAKE_DIR"];
  const value =
    configured !== undefined && configured.length > 0
      ? configured
      : "./report-lake";
  return path.resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const parsed = parseReplayArgs(Bun.argv.slice(2));
  if (parsed.kind === "help") {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const options = parsed.options;
  const pinPath = defaultDatasetPinPath(options.stage, Bun.env);
  const pin = await loadPin(pinPath);

  const issues = replayEnvironmentIssues({
    pin,
    environment: Bun.env,
    resolvedLakeDir: resolvedLakeDir(Bun.env),
  });
  if (issues.length > 0) {
    fail(
      [
        `This process is not pointed at the ${options.stage} dataset pinned in ${pinPath}:`,
        ...issues.map((issue) => `  - ${issue}`),
        "",
        "Set the environment to match the pin, for example:",
        `  DATABASE_URL=${pin.database.url} \\`,
        `  REPORT_LAKE_DIR=${pin.lake.dir} \\`,
        "  FEATURE_FLAGS_MODE=disabled \\",
        "  op run --env-file=./dev-web.env.tpl -- bun run test:explore:replay -- …",
      ].join("\n"),
    );
  }

  // Required by `configuration.ts` whatever the environment, and it must
  // name a real stage. An address is deliberately not set, so a namespace on
  // its own cannot reach a server — nothing in a replay may start a workflow.
  Bun.env["TEMPORAL_NAMESPACE"] ??= pin.stage;
  delete Bun.env["TEMPORAL_ADDRESS"];
  // A replay holds no S3 credentials, so the SDK walks its provider chain to
  // the EC2 metadata probe, which under bun can hang for minutes: competition
  // turns that read a cached leaderboard timed out mid-sweep. Disabled, the
  // chain fails in milliseconds and the load reports no cached board, as
  // test-setup.ts arranges for tests.
  Bun.env["AWS_EC2_METADATA_DISABLED"] = "true";

  // Only now is it safe to pull in the agent and everything it binds at import
  // time. Keeping this dynamic is what makes the guard above load-bearing
  // rather than advisory.
  const { runReplay } = await import("./run-replay.ts");
  const outcome = await runReplay({ options, pin, pinPath });

  if (!outcome.passed) {
    // A failing report must set a non-zero exit code or the eval silently
    // becomes decorative — the same rule `eval-report-output.ts` states.
    process.exitCode = 1;
  }
}

// A coherence failure carries its own repair instruction, produced where the
// pin is in scope; everything else reports its message and exits non-zero.
await main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
