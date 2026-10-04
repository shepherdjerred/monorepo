import { parseArgs } from "node:util";
import { z } from "zod";
import { ciCommand } from "#commands/ci.ts";
import { parseTimeout } from "#lib/ci/arguments.ts";

function validateOptions(
  action: string,
  values: {
    main: boolean;
    timeout?: string | undefined;
    head?: string | undefined;
    until: string;
  },
  positionals: string[],
): void {
  if (positionals.length > 1)
    throw new Error("Unexpected positional arguments");
  if (
    positionals.length > 0 &&
    (action === "main" || action === "load" || values.main)
  )
    throw new Error("Unexpected positional arguments");
  if (action !== "explain" && values.main)
    throw new Error("--main is only valid with ci explain");
  if (
    action !== "wait" &&
    (values.timeout !== undefined || values.until !== "first-failure")
  )
    throw new Error("--timeout and --until are wait options");
  if (
    values.head !== undefined &&
    (action === "main" || action === "load" || values.main)
  )
    throw new Error("--head requires a PR wait or explanation");
}

export async function handleCiCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
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
  explain [PR]    Print failures, bounded logs, review feedback, and deeper commands
  main            Show main's current push build and latest completed verdict
  load            Show Woodpecker/Kueue queues and CPU, memory, disk, I/O pressure

Options:
  --json                       One final JSON report on stdout
  --head <SHA>                 Assert/pin the expected full PR head SHA
  --until first-failure|settled Default: first-failure; settled collects blocking results
  --timeout <duration>         Optional deadline (e.g. 2h); default: unlimited
  --main                       explain main's failure without needing a PR

Wait exits: 0 ready, 1 check failure/conflict, 2 upstream/usage error,
3 human intervention, 4 head changed, 5 main red, 6 timeout, 7 PR closed/merged.
Long queues/builds are expected. Keep awaiting the same process, rather than
starting another status poll. Red main: report and await instructions.
`);
      return;
    }
    const action = z
      .enum(["wait", "explain", "main", "load"])
      .parse(subcommand);
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        head: { type: "string" },
        until: { type: "string", default: "first-failure" },
        timeout: { type: "string" },
        main: { type: "boolean", default: false },
      },
    });
    validateOptions(action, values, positionals);
    if (values.head !== undefined)
      z.string()
        .regex(/^[a-f\d]{40}$/i)
        .parse(values.head);
    if (positionals[0] !== undefined)
      z.coerce.number().int().positive().parse(positionals[0]);
    await ciCommand(action, positionals[0], {
      json: values.json,
      head: values.head?.toLowerCase(),
      timeoutMs:
        values.timeout === undefined ? undefined : parseTimeout(values.timeout),
      until: z.enum(["first-failure", "settled"]).parse(values.until),
      main: values.main,
    });
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
