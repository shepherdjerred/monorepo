/**
 * `toolkit incident`: reads and record mutations. Command claims live in
 * `command.ts`, the long-running `wait`/`watch` in `wait.ts`.
 *
 * `--expected-revision` defaults to the just-read revision only for `update`
 * (an append-only note) and `handoff`/`release` (the server checks the caller
 * is commander). `status`, `edit`, `resolve`, and `reopen` decide on what the
 * caller saw, so they require it.
 */
import {
  IncidentKindSchema,
  IncidentLinkInputSchema,
  IncidentSeveritySchema,
  IncidentStatusSchema,
  type ActorInput,
  type CheckIncidentsResult,
  type DeclareIncidentInput,
  type IncidentLinkInput,
  type IncidentSystem,
} from "@shepherdjerred/incidents/contract";
import { textInput } from "#commands/tracker/options.ts";
import type { IncidentsApi, IncidentRefusal } from "#lib/incidents/client.ts";
import {
  isBlocking,
  nextCommand,
  nextStep,
  nothingOpenText,
  relationText,
  shouldTake,
  summaryLine,
  type CheckedIncident,
} from "#lib/incidents/guidance.ts";
import type { Scheduler } from "#lib/incidents/scheduler.ts";
import type { RepoLocation, Spawner } from "#lib/incidents/spawn.ts";
import type { IncidentStream } from "#lib/incidents/stream.ts";
import {
  formatChange,
  formatDetail,
  formatList,
  result,
  type IncidentResult,
} from "./format.ts";
import {
  INCIDENT_EXIT,
  IncidentUsageError,
  parseLink,
  positiveInt,
  refArg,
  requireValue,
  revisionOf,
  suspectOf,
  systemsOf,
  type IncidentOptions,
} from "./options.ts";

export type IncidentCommandContext = {
  readonly url: string;
  readonly api: IncidentsApi;
  /** The native session actor; throws when the session has no identity. */
  readonly actor: () => Promise<ActorInput>;
  readonly stream: IncidentStream;
  readonly scheduler: Scheduler;
  readonly spawner: Spawner;
  readonly spawnerName: string;
  readonly repo: () => RepoLocation;
  /** Progress lines (stderr). */
  readonly log: (line: string) => void;
  readonly signal?: AbortSignal | undefined;
};

function parsed<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  value: string | undefined,
  label: string,
  choices: readonly string[],
): T | undefined {
  if (value === undefined) return undefined;
  const outcome = schema.safeParse(value);
  if (!outcome.success)
    throw new IncidentUsageError(
      `${label} must be one of ${choices.join(", ")}`,
    );
  return outcome.data;
}

async function optionalActor(
  context: IncidentCommandContext,
): Promise<ActorInput | undefined> {
  try {
    return await context.actor();
  } catch {
    return undefined;
  }
}

async function list(
  context: IncidentCommandContext,
  options: IncidentOptions,
): Promise<IncidentResult> {
  const state = options.state ?? "open";
  if (!["open", "resolved", "all"].includes(state))
    throw new IncidentUsageError("--state must be open, resolved, or all");
  const systems = systemsOf(options);
  if (systems.length > 1)
    throw new IncidentUsageError("list takes at most one --system");
  const kind = parsed(
    IncidentKindSchema,
    options.kind,
    "--kind",
    IncidentKindSchema.options,
  );
  const incidents = await context.api.list({
    state: state === "all" ? "all" : state === "resolved" ? "resolved" : "open",
    ...(kind === undefined ? {} : { kind }),
    ...(systems[0] === undefined ? {} : { system: systems[0] }),
    limit: positiveInt(options.limit, "--limit") ?? 50,
  });
  return result(INCIDENT_EXIT.ok, incidents, formatList(incidents));
}

/** Open incidents for each requested system (all when none), merged by id. */
async function checkSystems(
  api: IncidentsApi,
  systems: readonly IncidentSystem[],
  actor: ActorInput | undefined,
): Promise<CheckIncidentsResult> {
  const withActor = actor === undefined ? {} : { actor };
  if (systems.length === 0) return api.check(withActor);
  const results = await Promise.all(
    systems.map((system) => api.check({ system, ...withActor })),
  );
  const seen = new Set<string>();
  const incidents = results
    .flatMap((item) => item.incidents)
    .filter((entry) => {
      if (seen.has(entry.incident.id)) return false;
      seen.add(entry.incident.id);
      return true;
    });
  return {
    checkedAt: results[0]?.checkedAt ?? new Date().toISOString(),
    incidents,
  };
}

function checkExit(incidents: readonly CheckedIncident[]): number {
  if (incidents.some((entry) => shouldTake(entry)))
    return INCIDENT_EXIT.suspect;
  return incidents.some((entry) => isBlocking(entry.incident))
    ? INCIDENT_EXIT.open
    : INCIDENT_EXIT.ok;
}

async function check(
  context: IncidentCommandContext,
  options: IncidentOptions,
): Promise<IncidentResult> {
  const systems = systemsOf(options);
  const actor = await optionalActor(context);
  const checked = await checkSystems(context.api, systems, actor);
  const focus =
    checked.incidents.find((entry) => shouldTake(entry)) ??
    checked.incidents.find((entry) => isBlocking(entry.incident)) ??
    null;
  const systemLabel = systems.length === 0 ? undefined : systems.join(",");
  const recommended =
    focus === null ? nothingOpenText(systemLabel) : nextStep(focus);
  const text = [
    ...checked.incidents.map(
      (entry) =>
        `${summaryLine(entry.incident)}\n  you: ${relationText(entry.relation)} · next: ${nextCommand(entry)}`,
    ),
    ...(actor === undefined
      ? [
          "(No session identity: relations are unknown. Set TRACKER_ACTOR_KEY/KIND or run inside an agent session.)",
        ]
      : []),
    `Next: ${recommended}`,
  ].join("\n");
  const exitCode = checkExit(checked.incidents);
  return result(
    exitCode,
    {
      checkedAt: checked.checkedAt,
      incidents: checked.incidents.map((entry) => ({
        ...entry,
        next: nextCommand(entry),
      })),
      recommended,
      exitCode,
    },
    text,
  );
}

async function declare(
  context: IncidentCommandContext,
  options: IncidentOptions,
): Promise<IncidentResult> {
  const systems = systemsOf(options);
  if (systems.length === 0)
    throw new IncidentUsageError("--system is required (repeatable)");
  const kind =
    parsed(
      IncidentKindSchema,
      options.kind,
      "--kind",
      IncidentKindSchema.options,
    ) ?? "incident";
  const severity = parsed(
    IncidentSeveritySchema,
    requireValue(options.severity, "--severity sev1|sev2|sev3"),
    "--severity",
    IncidentSeveritySchema.options,
  );
  if (
    kind === "maintenance" &&
    (options.start === undefined || options.end === undefined)
  )
    throw new IncidentUsageError(
      "--kind maintenance needs --start and --end (ISO 8601)",
    );
  const suspect = suspectOf(options);
  const input: DeclareIncidentInput = {
    actor: await context.actor(),
    kind,
    title: requireValue(options.title, "--title"),
    summary: options.summary ?? "",
    ...(options.impact === undefined ? {} : { impact: options.impact }),
    ...(severity === undefined ? {} : { severity }),
    systems,
    components: options.component ?? [],
    exitCondition: requireValue(options["exit-condition"], "--exit-condition"),
    ...(suspect === undefined ? {} : { suspect }),
    links: (options.link ?? []).map((value) => parseLink(value)),
    takeCommand: options.take,
    ...(options.start === undefined ? {} : { scheduledStart: options.start }),
    ...(options.end === undefined ? {} : { scheduledEnd: options.end }),
  };
  const detail = await context.api.declare(input);
  const id = detail.identifier;
  const next = options.take
    ? `You are commander. Post milestones: toolkit incident update ${id} --body "<progress>"`
    : `Take command if you are fixing it: toolkit incident take ${id}`;
  return result(
    INCIDENT_EXIT.ok,
    detail,
    `Declared ${summaryLine(detail)}\n${detail.url}\n${next}`,
  );
}

/** `--expected-revision`, which decisions made on a read must carry. */
function requiredRevision(
  ref: string,
  options: IncidentOptions,
  action: string,
): number {
  const explicit = revisionOf(options);
  if (explicit === undefined)
    throw new IncidentUsageError(
      `${action} needs --expected-revision; read it with toolkit incident view ${ref}`,
    );
  return explicit;
}

/** `--expected-revision`, or the revision just read when the change does not depend on it. */
export async function currentRevision(
  context: IncidentCommandContext,
  ref: string,
  options: IncidentOptions,
): Promise<number> {
  const explicit = revisionOf(options);
  if (explicit !== undefined) return explicit;
  const detail = await context.api.byRef(ref);
  return detail.revision;
}

async function noteText(options: IncidentOptions): Promise<string | undefined> {
  return textInput(options.note, options["note-file"]);
}

async function recordMutation(
  context: IncidentCommandContext,
  action:
    | "update"
    | "status"
    | "edit"
    | "link"
    | "join"
    | "leave"
    | "resolve"
    | "reopen",
  positionals: string[],
  options: IncidentOptions,
): Promise<IncidentResult> {
  const ref = refArg(positionals, action);
  const actor = await context.actor();
  const api = context.api;
  const note = await noteText(options);
  const detail = await (async () => {
    switch (action) {
      case "update":
        return api.postUpdate({
          actor,
          ref,
          expectedRevision: await currentRevision(context, ref, options),
          body: requireValue(
            await textInput(options.body, options["body-file"]),
            "--body or --body-file",
          ),
        });
      case "status": {
        const status = parsed(
          IncidentStatusSchema,
          requireValue(
            positionals[1],
            "toolkit incident status <INC-N> <STATUS>",
          ),
          "status",
          IncidentStatusSchema.options,
        );
        if (status === undefined)
          throw new IncidentUsageError("status is required");
        return api.changeStatus({
          actor,
          ref,
          expectedRevision: requiredRevision(ref, options, action),
          status,
          ...(note === undefined ? {} : { note }),
        });
      }
      case "edit":
        return api.edit(editInput(ref, actor, options));
      case "link":
        return api.addLink({ actor, ref, link: linkFromOptions(options) });
      case "join":
        return api.join({
          actor,
          ref,
          ...(note === undefined ? {} : { note }),
        });
      case "leave":
        return api.leave({
          actor,
          ref,
          ...(note === undefined ? {} : { note }),
        });
      case "resolve":
        return api.resolve({
          actor,
          ref,
          expectedRevision: requiredRevision(ref, options, action),
          note: requireValue(
            note,
            "--note or --note-file (evidence that the exit condition holds)",
          ),
          force: options.force,
        });
      case "reopen":
        return api.reopen({
          actor,
          ref,
          expectedRevision: requiredRevision(ref, options, action),
          note: requireValue(note, "--note or --note-file"),
        });
    }
  })();
  return result(INCIDENT_EXIT.ok, detail, formatChange(detail));
}

/** `link --kind K --ref R [--url U] [--title T]`, validated like `--link`. */
function linkFromOptions(options: IncidentOptions): IncidentLinkInput {
  const base = parseLink(
    `${requireValue(options.kind, "--kind")}=${requireValue(options.ref, "--ref")}`,
  );
  const link = IncidentLinkInputSchema.safeParse({
    ...base,
    ...(options.url === undefined ? {} : { url: options.url }),
    ...(options.title === undefined ? {} : { title: options.title }),
  });
  if (!link.success)
    throw new IncidentUsageError(
      `link: ${link.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`,
    );
  return link.data;
}

function editInput(ref: string, actor: ActorInput, options: IncidentOptions) {
  const systems = systemsOf(options);
  const suspect = suspectOf(options);
  if (suspect !== undefined && options["clear-suspect"])
    throw new IncidentUsageError("Choose --suspect-* or --clear-suspect");
  const severity = parsed(
    IncidentSeveritySchema,
    options.severity,
    "--severity",
    IncidentSeveritySchema.options,
  );
  return {
    actor,
    ref,
    expectedRevision: requiredRevision(ref, options, "edit"),
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
    ...(options.impact === undefined
      ? {}
      : { impact: options.impact === "none" ? null : options.impact }),
    ...(severity === undefined ? {} : { severity }),
    ...(systems.length === 0 ? {} : { systems }),
    ...(options.component === undefined
      ? {}
      : { components: options.component }),
    ...(options["exit-condition"] === undefined
      ? {}
      : { exitCondition: options["exit-condition"] }),
    ...(options["clear-suspect"]
      ? { suspect: null }
      : suspect === undefined
        ? {}
        : { suspect }),
  };
}

export async function incidentRecordCommand(
  context: IncidentCommandContext,
  action:
    | "list"
    | "check"
    | "view"
    | "show"
    | "declare"
    | "update"
    | "status"
    | "edit"
    | "link"
    | "join"
    | "leave"
    | "resolve"
    | "reopen",
  positionals: string[],
  options: IncidentOptions,
): Promise<IncidentResult> {
  if (action === "list") return list(context, options);
  if (action === "check") return check(context, options);
  if (action === "declare") return declare(context, options);
  if (action === "view" || action === "show") {
    const detail = await context.api.byRef(refArg(positionals, action));
    return result(INCIDENT_EXIT.ok, detail, formatDetail(detail));
  }
  return recordMutation(context, action, positionals, options);
}

/** Text and exit code for a server refusal; CONFLICT payloads get exact next commands. */
export function refusalResult(refusal: IncidentRefusal): IncidentResult {
  const conflict = refusal.conflict;
  if (conflict?.code === "duplicate-incident") {
    const existing = conflict.existing;
    const id = existing.identifier;
    return result(
      INCIDENT_EXIT.duplicate,
      {
        error: refusal,
        next: [`toolkit incident wait ${id}`, `toolkit incident join ${id}`],
      },
      [
        `${id} is already open for ${conflict.systems.join(", ")}: ${summaryLine(existing)}`,
        `Wait on it (joins as affected; takes over if nobody does): toolkit incident wait ${id}`,
        `Or only join as affected: toolkit incident join ${id}`,
      ].join("\n"),
    );
  }
  if (conflict?.code === "stale-revision") {
    const id = conflict.incident.identifier;
    return result(
      INCIDENT_EXIT.stale,
      { error: refusal },
      `${id} is at revision ${String(conflict.incident.revision)}, not ${String(conflict.expectedRevision)}. Re-read with toolkit incident view ${id} and retry with --expected-revision ${String(conflict.incident.revision)}.`,
    );
  }
  return result(
    refusal.code === "CONFLICT"
      ? INCIDENT_EXIT.notTaken
      : INCIDENT_EXIT.failure,
    { error: refusal },
    `${refusal.code}: ${refusal.message}`,
  );
}
