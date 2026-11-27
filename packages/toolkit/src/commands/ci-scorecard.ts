import { parseArgs } from "node:util";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { sanitizeText } from "#lib/ci/redaction.ts";
import { ciScorecard, formatScorecard } from "#lib/ci/scorecard/scorecard.ts";
import { loadWoodpeckerConfig } from "#lib/woodpecker/ci.ts";

const USAGE = `toolkit ci scorecard [--since 24h] [--json]

One report on the CI program's targets: ready-PR pipelines end to end (p50 and
p90, split into agent wait, Kueue gate and run) and the share that failed,
main-push latency, Woodpecker's pending and running workflows now, and the CI
pool's writes over the last 24 hours by writer against their budgets.

  --since <duration>   Pipeline window (default: 24h). Pool writes are always 24h.
  --json               One JSON report on stdout
`;

/** Parses before `authenticate`, so help and bad flags need no credentials. */
export async function ciScorecardCommand(
  args: string[],
  authenticate: () => Promise<void>,
): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      since: { type: "string", default: "24h" },
      json: { type: "boolean", default: false },
    },
  });
  const windowSeconds = parseTimeout(values.since, "--since") / 1000;
  await authenticate();
  const config = await loadWoodpeckerConfig();
  const until = Date.now() / 1000;
  const report = await ciScorecard(
    config,
    until - windowSeconds,
    until,
    AbortSignal.timeout(110_000),
  );
  console.log(
    sanitizeText(
      values.json ? JSON.stringify(report, null, 2) : formatScorecard(report),
      [config.token],
    ),
  );
}
