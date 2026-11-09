import { parseArgs } from "node:util";
import { z } from "zod";
import { ciCommand } from "#commands/ci.ts";
import { parseTimeout } from "#lib/ci/arguments.ts";
import { ciBenchmarkCommand } from "#commands/ci-benchmark.ts";
import { ciSourceProofCommand } from "#commands/ci-source-proof.ts";
import { ciAnalyzeCommand } from "#commands/ci-analyze.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import { resolveCredentials } from "#lib/credentials.ts";

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

async function runAnalyze(args: string[]): Promise<void> {
  try {
    await ciAnalyzeCommand(args, async () => {
      await resolveCredentials(requiredCredentialsFor("ci", "analyze"));
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

export async function handleCiCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (subcommand === "benchmark") {
    await ciBenchmarkCommand(args);
    return;
  }
  if (subcommand === "source-proof") {
    await ciSourceProofCommand(args);
    return;
  }
  if (subcommand === "analyze") {
    await runAnalyze(args);
    return;
  }
  const json = args.includes("--json");
  try {
    if (
      subcommand === undefined ||
      subcommand === "--help" ||
      subcommand === "-h" ||
      args.includes("--help") ||
      args.includes("-h")
    ) {
      console.log(`toolkit ci - foreground PR waits and failure evidence

  wait [PR]       Wait for merge readiness; return on the first actionable blocker
  wait --main     Wait for main's own verifying run at --head (default: main's tip)
  wait --main --follow  Follow main's tip until its current commit passes
  explain [PR]    Print failures, bounded logs, review feedback, and deeper commands
  main            Show main's current verification and latest completed verdict
  load            Show Woodpecker/Kueue queues and CPU, memory, disk, I/O pressure
  timings         Report recent latency by actual workflow class and attempt
  analyze         Rank uncached tasks, critical paths, repeated misses and hot files
  maintenance     Show recent maintenance runs and coordinator inspection details
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
only after the PR itself is ready. wait --main exits 0 when the pinned main
commit's run passes and 1 when it fails. Long queues/builds are expected. Keep
awaiting the same process, rather than starting another status poll. Keep
working if main is red; do not try to fix main unless explicitly told. To wait
and then merge, use toolkit pr land.
`);
      return;
    }
    const action = z
      .enum(["wait", "explain", "main", "load", "timings", "maintenance"])
      .parse(subcommand);
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
    if (values.head !== undefined)
      z.string()
        .regex(/^[a-f\d]{40}$/i)
        .parse(values.head);
    if (positionals[0] !== undefined)
      z.coerce.number().int().positive().parse(positionals[0]);
    const options = {
      json: values.json,
      head: values.head?.toLowerCase(),
      timeoutMs:
        values.timeout === undefined ? undefined : parseTimeout(values.timeout),
      until: z.enum(["first-failure", "settled"]).parse(values.until),
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
