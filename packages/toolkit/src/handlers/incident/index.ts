import { TRPCClientError } from "@trpc/client";
import { ZodError } from "zod";
import path from "node:path";
import {
  incidentActor,
  incidentRefusal,
  incidentsApi,
  hubBaseUrl,
} from "#lib/incidents/client.ts";
import { realScheduler } from "#lib/incidents/scheduler.ts";
import { processSpawner, repoLocation } from "#lib/incidents/spawn.ts";
import { incidentStream } from "#lib/incidents/stream.ts";
import { agentWaitHint } from "#lib/ci/wait/agent-hint.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";
import { sessionActor } from "#lib/tracker/context.ts";
import {
  incidentRecordCommand,
  refusalResult,
  type IncidentCommandContext,
} from "#commands/incident/record.ts";
import { incidentClaimCommand } from "#commands/incident/command.ts";
import type { IncidentResult } from "#commands/incident/format.ts";
import {
  INCIDENT_EXIT,
  IncidentActionSchema,
  IncidentUsageError,
  parseIncidentArgs,
  type IncidentAction,
  type IncidentOptions,
} from "#commands/incident/options.ts";
import {
  CANCELED_EXIT,
  incidentWaitCommand,
  incidentWatchCommand,
} from "#commands/incident/wait.ts";

export const INCIDENT_HELP = `toolkit incident <COMMAND> [INC-N] [OPTIONS]

Blocked by Delivery, a red main, or another shared system?
  1. toolkit incident check [--system X]   what is open, and your relation to it
  2. You caused it (exit 11)?              toolkit incident take INC-N, then fix it
  3. Otherwise                             toolkit incident wait INC-N   (or --system X)
     Joins as affected, holds one stream, exits 0 when resolved. If nobody has
     command once the takeover grace passes, exactly one waiter wins a dispatch
     lease and spawns a commander session (herdr-new-worktree); the rest keep waiting.
  4. Nothing open?                         toolkit incident declare ... (a duplicate names the open one)

Commands:
  list [--state open|resolved|all] [--kind incident|maintenance] [--system X] [--limit N]
  check [--system X]...                 Open incidents with your relation and the next command
  view <INC-N>
  declare --title T --system X... --severity sev1|sev2|sev3 --exit-condition TEXT
          [--summary T] [--impact T] [--component C]... [--link kind=ref[,url]]...
          [--suspect-pr N] [--suspect-commit SHA] [--suspect-branch B] [--take]
          [--kind maintenance --start ISO --end ISO]
  update <INC-N> --body TEXT|--body-file PATH
  status <INC-N> <STATUS> --expected-revision N [--note TEXT]
  edit <INC-N> --expected-revision N [--title --summary --impact T|none --severity
          --system X... --component C... --exit-condition --suspect-* | --clear-suspect]
  link <INC-N> --kind KIND --ref REF [--url URL] [--title T]
  join <INC-N> [--note T] | leave <INC-N> [--note T]
  take <INC-N> [--force] [--spawn] [--note T]
  claim <INC-N> --dispatch-token TOKEN  Redeem a dispatch lease (run by the spawned session)
  handoff <INC-N> --to KEY|none [--note T] | release <INC-N> [--note T]
  resolve <INC-N> --expected-revision N --note EVIDENCE [--force]
  reopen <INC-N> --expected-revision N --note TEXT
  watch [INC-N] [--until-resolved] [--timeout-sec N]
  wait <INC-N> | --system X [--no-spawn] [--timeout-sec N]

Options:
  --json                    One JSON value on stdout (watch: NDJSON); progress on stderr
  --hub-url URL             Hub base URL (default OPS_DASHBOARD_URL / ops.dashboard.url)
  --actor-key KEY --actor-kind KIND --actor-name NAME   Override the session actor
  --expected-revision N     Required for status, edit, resolve, reopen; update and
                            handoff/release default to the current revision

Exits: 0 ok (check: nothing relevant; wait: resolved or nothing open), 1 refused or
unreachable, 2 usage, 6 timeout, 10 check: relevant open incident, 11 you likely
caused it (take it), 12 wait: you are commander, 13 declare: duplicate (wait/join
the named incident), 14 stale --expected-revision, 15 take/claim: not taken.
130/143 SIGINT/SIGTERM. Every <INC-N> also accepts N or the incident UUID.
`;

type Cancellation = {
  readonly signal: AbortSignal;
  exit: number;
  cleanup: () => void;
};

function cancellation(): Cancellation {
  const controller = new AbortController();
  const state: Cancellation = {
    signal: controller.signal,
    exit: CANCELED_EXIT,
    cleanup: () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    },
  };
  const interrupt = () => {
    state.exit = 130;
    controller.abort();
  };
  const terminate = () => {
    state.exit = 143;
    controller.abort();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  return state;
}

async function buildContext(
  options: IncidentOptions,
  signal: AbortSignal | undefined,
): Promise<IncidentCommandContext> {
  const config = await loadToolkitConfig();
  const url = hubBaseUrl(
    options["hub-url"] ?? (await config.value("opsDashboardUrl")),
  );
  const spawner = await config.value("incidentSpawner");
  return {
    url,
    api: incidentsApi(url),
    actor: async () =>
      incidentActor(
        await sessionActor(
          {
            "actor-key": options["actor-key"],
            "actor-kind": options["actor-kind"],
            "actor-name": options["actor-name"],
          },
          config,
        ),
      ),
    stream: incidentStream(url),
    scheduler: realScheduler,
    spawner: processSpawner(spawner),
    spawnerName: path.basename(spawner),
    repo: () => repoLocation(),
    log: (line) => {
      console.error(line);
    },
    signal,
  };
}

type ContextFactory = (
  options: IncidentOptions,
  signal: AbortSignal | undefined,
) => Promise<IncidentCommandContext>;

type Invocation = {
  readonly action: IncidentAction;
  readonly positionals: string[];
  readonly options: IncidentOptions;
  readonly emit: (line: string) => void;
};

function dispatchAction(
  context: IncidentCommandContext,
  invocation: Invocation,
): Promise<IncidentResult> {
  const { action, positionals, options } = invocation;
  if (action === "wait")
    return incidentWaitCommand(context, positionals.slice(0, 1), options);
  if (action === "watch")
    return incidentWatchCommand(context, positionals, options, invocation.emit);
  return action === "take" ||
    action === "claim" ||
    action === "handoff" ||
    action === "release"
    ? incidentClaimCommand(context, action, positionals, options)
    : incidentRecordCommand(context, action, positionals, options);
}

/** Any failure as a result: usage → 2, refusals → their exit, everything else → 1. */
export function failureResult(error: unknown): IncidentResult {
  if (error instanceof IncidentUsageError || error instanceof ZodError) {
    const text =
      error instanceof ZodError
        ? `Invalid input: ${error.issues.map((issue) => `${issue.path.join(".") || "value"} ${issue.message}`).join("; ")}`
        : error.message;
    return {
      exitCode: INCIDENT_EXIT.usage,
      json: { error: { code: "USAGE", message: text } },
      text,
    };
  }
  const refusal = incidentRefusal(error);
  if (refusal !== null) return refusalResult(refusal);
  const detail = error instanceof Error ? error.message : String(error);
  const transport = error instanceof TRPCClientError;
  const text = transport
    ? `Incidents request failed: ${detail}`
    : `toolkit incident: ${detail}`;
  return {
    exitCode: INCIDENT_EXIT.failure,
    json: {
      error: { code: transport ? "UNAVAILABLE" : "FAILED", message: text },
    },
    text,
  };
}

/** Parse, run, and map every failure to an exit code. Never throws. */
export async function executeIncidentCommand(
  createContext: ContextFactory,
  action: string,
  args: string[],
  runtime: {
    readonly emit: (line: string) => void;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<IncidentResult> {
  try {
    const parsedAction = IncidentActionSchema.safeParse(action);
    if (!parsedAction.success)
      throw new IncidentUsageError(
        `Unknown incident command ${action}; run toolkit incident --help`,
      );
    const { values, positionals } = parseIncidentArgs(args);
    const context = await createContext(values, runtime.signal);
    if (parsedAction.data === "wait") {
      const hint = agentWaitHint(Bun.env);
      if (hint !== null) context.log(hint);
    }
    return await dispatchAction(context, {
      action: parsedAction.data,
      positionals,
      options: values,
      emit: runtime.emit,
    });
  } catch (error) {
    return failureResult(error);
  }
}

function isHelp(action: string | undefined, args: string[]): boolean {
  return (
    action === undefined ||
    action === "--help" ||
    action === "-h" ||
    args.includes("--help") ||
    args.includes("-h")
  );
}

function print(outcome: IncidentResult, exitCode: number, json: boolean) {
  if (json) {
    if (outcome.json !== null)
      console.log(JSON.stringify(outcome.json, null, 2));
    return;
  }
  if (outcome.text === "") return;
  const failed =
    exitCode === INCIDENT_EXIT.usage || exitCode === INCIDENT_EXIT.failure;
  (failed ? process.stderr : process.stdout).write(`${outcome.text}\n`);
}

export async function handleIncidentCommand(
  action: string | undefined,
  args: string[],
): Promise<void> {
  if (action === undefined || isHelp(action, args)) {
    console.log(INCIDENT_HELP);
    return;
  }
  const cancel =
    action === "wait" || action === "watch" ? cancellation() : null;
  const outcome = await executeIncidentCommand(buildContext, action, args, {
    emit: (line) => {
      console.log(line);
    },
    signal: cancel?.signal,
  });
  cancel?.cleanup();
  const exitCode =
    cancel !== null && outcome.exitCode === CANCELED_EXIT
      ? cancel.exit
      : outcome.exitCode;
  print(outcome, exitCode, args.includes("--json"));
  process.exitCode = exitCode;
}
