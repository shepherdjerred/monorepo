import { parseArgs } from "node:util";
import { ciCommand } from "#commands/ci.ts";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { ciBenchmarkCommand } from "#commands/ci-benchmark.ts";
import { ciSourceProofCommand } from "#commands/ci-source-proof.ts";
import { ciAnalyzeCommand } from "#commands/ci-analyze.ts";
import { ciMaintenanceRetryCommand } from "#commands/ci-maintenance-retry.ts";
import { ciScorecardCommand } from "#commands/ci-scorecard.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import { resolveCredentials } from "#lib/credentials.ts";

const CI_ACTIONS = [
  "wait",
  "explain",
  "main",
  "load",
  "timings",
  "maintenance",
] as const;

type CiAction = (typeof CI_ACTIONS)[number];

function parseCiAction(value: string): CiAction {
  for (const candidate of CI_ACTIONS) {
    if (value === candidate) return candidate;
  }
  throw new Error(
    `Unknown ci subcommand '${value}' (expected: ${CI_ACTIONS.join(", ")}, analyze, benchmark, source-proof)`,
  );
}

function parseUntil(value: string): "first-failure" | "settled" {
  if (value === "first-failure" || value === "settled") return value;
  throw new Error("--until must be 'first-failure' or 'settled'");
}

function isHelpRequest(
  subcommand: string | undefined,
  args: string[],
): boolean {
  return (
    subcommand === undefined ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    args.includes("--help") ||
    args.includes("-h")
  );
}

function validateHeadSha(
  action: CiAction,
  main: boolean,
  head: string | undefined,
): void {
  if (head === undefined) return;
  if (action === "wait" && main) {
    if (!/^[a-f\d]{7,40}$/iu.test(head)) {
      throw new Error(
        "--head must be a 7 to 40-character hexadecimal commit SHA",
      );
    }
    return;
  }
  if (!/^[a-f\d]{40}$/iu.test(head)) {
    throw new Error(
      "--head must be a full 40-character hexadecimal commit SHA",
    );
  }
}

function validatePositionalPr(pr: string | undefined): void {
  if (pr !== undefined && !/^[1-9]\d*$/u.test(pr)) {
    throw new Error("PR must be a positive number");
  }
}

type OptionValues = {
  main: boolean;
  follow: boolean;
  timeout?: string | undefined;
  head?: string | undefined;
  since?: string | undefined;
  until: string;
};

const NO_TARGET_ACTIONS = new Set(["main", "load", "timings", "maintenance"]);

/** Rules for `--main`, which turns wait and explain into main-only commands. */
function validateMainOptions(action: string, values: OptionValues): void {
  const mainWait = action === "wait" && values.main;
  if (action !== "explain" && action !== "wait" && values.main)
    throw new Error("--main is only valid with ci wait or ci explain");
  if (mainWait && values.until !== "first-failure")
    throw new Error("--until applies to PR waits, not ci wait --main");
  if (!mainWait && values.follow)
    throw new Error("--follow is only valid with ci wait --main");
  if (values.follow && values.head !== undefined)
    throw new Error("--follow follows main's tip; it cannot pin --head");
}

function validateOptions(
  action: string,
  values: OptionValues,
  positionals: string[],
): void {
  const noTarget = NO_TARGET_ACTIONS.has(action);
  if (
    positionals.length > 1 ||
    (positionals.length > 0 && (noTarget || values.main))
  )
    throw new Error("Unexpected positional arguments");
  validateMainOptions(action, values);
  if (action !== "timings" && values.since !== undefined)
    throw new Error("--since is only valid with ci timings");
  if (
    action !== "wait" &&
    (values.timeout !== undefined || values.until !== "first-failure")
  )
    throw new Error("--timeout and --until are wait options");
  if (
    values.head !== undefined &&
    (noTarget || (action !== "wait" && values.main))
  )
    throw new Error("--head requires a PR or main wait, or a PR explanation");
}

async function reportingFailures(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

/** Subcommands that parse their own arguments instead of the shared options. */
function standaloneCommand(
  subcommand: string,
  args: string[],
): (() => Promise<void>) | null {
  switch (subcommand) {
    case "benchmark":
      return () => ciBenchmarkCommand(args);
    case "source-proof":
      return () => ciSourceProofCommand(args);
    case "analyze":
      return () =>
        reportingFailures(() =>
          ciAnalyzeCommand(args, async () => {
            await resolveCredentials(requiredCredentialsFor("ci", "analyze"));
          }),
        );
    case "scorecard":
      return () =>
        reportingFailures(() =>
          ciScorecardCommand(args, async () => {
            await resolveCredentials(requiredCredentialsFor("ci", "scorecard"));
          }),
        );
    case "maintenance":
      return args[0] === "retry"
        ? () =>
            reportingFailures(() => ciMaintenanceRetryCommand(args.slice(1)))
        : null;
    default:
      return null;
  }
}

export async function handleCiCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  const standalone =
    subcommand === undefined ? null : standaloneCommand(subcommand, args);
  if (standalone !== null) {
    await standalone();
    return;
  }
  const json = args.includes("--json");
  try {
    if (isHelpRequest(subcommand, args)) {
      console.log(`toolkit ci - foreground PR waits and failure evidence

  wait [PR]       Wait for merge readiness; return on the first actionable blocker
  wait --main     Wait for main's own verifying run at --head (default: main's tip)
  wait --main --follow  Follow main's tip until its current commit passes
  explain [PR]    Print failures, bounded logs, review feedback, and deeper commands
  main            Show main's current verification and latest completed verdict
  load            Show Woodpecker/Kueue queues and CPU, memory, disk, I/O pressure
  timings         Report recent latency by actual workflow class and attempt
  scorecard       Ready-PR and main latency, failure share, queue, and CI pool writes by writer
  analyze         Rank uncached tasks, critical paths, miss causes, repeated misses and hot files
  maintenance     Show recent maintenance runs and coordinator inspection details
  maintenance retry <kind> [--apply]  Retry a blocked maintenance stream (dry run by default)
  benchmark       Inspect and archive retained canary resource evidence
  source-proof PR --source SHA  Verify exact reviewed, green source is merged into main before bootstrap

Options:
  --json                       One final JSON report on stdout
  --head <SHA>                 Pin the full PR head SHA, or the main commit with --main
  --until first-failure|settled Default: first-failure; settled collects blocking results
  --timeout <duration>         Optional deadline (e.g. 2h); default: unlimited
  --main                       wait: main's run; explain: main's failure without a PR
  --follow                     wait --main: keep following new main commits until one passes
  --since <duration>           timings history window (default: 72h)

Wait exits: 0 ready, 1 check failure/conflict, 2 upstream/usage error,
3 human intervention, 4 head changed, 5 PR ready but main red, 6 timeout,
7 PR closed/merged. A red main never ends a PR wait early; exit 5 is reported
only after the PR itself is ready, with the open main-ci incident and the
toolkit incident command to run (wait on it, or take it if you caused it). wait --main exits 0 when the pinned main
commit's run passes and 1 when it fails. Long queues/builds are expected. Keep
awaiting the same process, rather than starting another status poll. Keep
working if main is red; check toolkit incident check --system main-ci and
toolkit forum list --json first, follow an owned
recovery, fix failures your changes caused, or claim/post a notice (--owner me)
before picking up an unowned blocker with no better active owner. To wait and
then merge, use toolkit pr land.
`);
      return;
    }
    const action = parseCiAction(subcommand ?? "");
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        head: { type: "string" },
        until: { type: "string", default: "first-failure" },
        timeout: { type: "string" },
        since: { type: "string" },
        main: { type: "boolean", default: false },
        follow: { type: "boolean", default: false },
      },
    });
    validateOptions(action, values, positionals);
    validateHeadSha(action, values.main, values.head);
    validatePositionalPr(positionals[0]);
    const options = {
      json: values.json,
      head: values.head?.toLowerCase(),
      timeoutMs:
        values.timeout === undefined ? undefined : parseTimeout(values.timeout),
      until: parseUntil(values.until),
      main: values.main,
      follow: values.follow,
      sinceMs: parseTimeout(values.since ?? "72h", "--since"),
    };
    await resolveCredentials(requiredCredentialsFor("ci", action));
    await ciCommand(action, positionals[0], options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (json)
      console.log(
        JSON.stringify({ outcome: "error", ready: false, error: message }),
      );
    else console.error(message);
    process.exitCode = 2;
  }
}
