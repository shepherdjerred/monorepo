/**
 * Local Layer-2 test harness for the alert-remediation agent (no Temporal).
 *
 * Imports `runAlertRemediationAgent` directly and runs it against a REAL
 * `claude` subprocess so you can watch the new `--output-format stream-json`
 * NDJSON stream live (every `agent event` line — system init, assistant
 * turns + tool calls, the final result), the fastest inner loop for the
 * observability work. Bypasses Temporal entirely (no worker, no server), so
 * there is no activity Context — the soft-kill / SIGKILL path is NOT exercised
 * here (see src/shared/agent-subprocess.test.ts + the e2e test for that).
 *
 * Usage:
 *   op run --env-file=.env.alert-remediation -- \
 *     bun run scripts/run-alert-remediation-local.ts --workdir=/tmp/mono-throwaway
 *   op run --env-file=.env.alert-remediation -- \
 *     bun run scripts/run-alert-remediation-local.ts --haiku --max-turns=5
 *
 * Requires (via op run): CLAUDE_CODE_OAUTH_TOKEN and the GITHUB_APP_* trio
 * (the activity mints a short-lived installation token). Provide a throwaway
 * checkout via --workdir for repo-aware runs — the agent may edit files there.
 * With an empty/default workdir the agent has no repo to fix and will return
 * report-only / not-straightforward, which is still a full streaming smoke.
 *
 * Flags:
 *   --workdir=<path>   repo checkout the agent runs in (default: a temp dir)
 *   --source=...       pagerduty|bugsink (default: pagerduty)
 *   --title=<text>     alert title (default: "local test alert")
 *   --haiku            use claude-haiku-4-5-20251001
 *   --model=<id>       model override
 *   --max-turns=<n>    agent max turns (default: 15)
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { alertRemediationActivities } from "#activities/alert-remediation.ts";

type Args = {
  workdir: string | undefined;
  source: "pagerduty" | "bugsink";
  title: string;
  model: string | undefined;
  maxTurns: number;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    workdir: undefined,
    source: "pagerduty",
    title: "local test alert",
    model: undefined,
    maxTurns: 15,
  };
  for (const arg of argv) {
    if (arg.startsWith("--workdir=")) {
      args.workdir = arg.slice("--workdir=".length);
    } else if (arg === "--source=bugsink") {
      args.source = "bugsink";
    } else if (arg === "--source=pagerduty") {
      args.source = "pagerduty";
    } else if (arg.startsWith("--title=")) {
      args.title = arg.slice("--title=".length);
    } else if (arg === "--haiku") {
      args.model = "claude-haiku-4-5-20251001";
    } else if (arg.startsWith("--model=")) {
      args.model = arg.slice("--model=".length);
    } else if (arg.startsWith("--max-turns=")) {
      args.maxTurns = Number(arg.slice("--max-turns=".length));
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workdir =
    args.workdir ??
    (await mkdtemp(path.join(tmpdir(), "alert-remediation-local-")));

  const input = {
    alert: {
      source: args.source,
      fingerprint: `${args.source}:local-test`,
      title: args.title,
      status: "triggered",
      severity: "high",
      details: { note: "Synthetic alert from run-alert-remediation-local.ts" },
    },
    repo: { fullName: "shepherdjerred/monorepo", ref: "main" },
    provider: "claude" as const,
    model: args.model,
    maxTurns: args.maxTurns,
  };

  console.warn(
    JSON.stringify({
      level: "info",
      msg: "Running alert-remediation agent locally (no Temporal)",
      workdir,
      model: args.model ?? "(default)",
      maxTurns: args.maxTurns,
    }),
  );

  const result = await alertRemediationActivities.runAlertRemediationAgent({
    input,
    workdir,
  });

  console.warn(
    JSON.stringify({ level: "info", msg: "Result", result }, null, 2),
  );
}

void (async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
