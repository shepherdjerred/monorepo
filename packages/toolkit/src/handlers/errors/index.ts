import type { z } from "zod";
import {
  eventCommand,
  eventsCommand,
  issueCommand,
  issuesCommand,
  stacktraceCommand,
} from "#commands/errors/issues.ts";
import {
  importBugsinkCommand,
  trackerIssueCommand,
  updateIssueStateCommand,
} from "#commands/errors/mutations.ts";
import {
  overviewCommand,
  projectCommand,
  projectsCommand,
  releasesCommand,
} from "#commands/errors/read.ts";
import {
  IssueFilterTabSchema,
  IssueStateSchema,
  TrackerTriageEffortSchema,
  TrackerTriageImpactSchema,
  TrackerTriageUrgencySchema,
} from "@shepherdjerred/errors/contract";
import { parseArgs } from "node:util";

const HELP_TEXT = `
toolkit errors - First-party error tracking

Subcommands:
  overview                             Service overview and attention issues
  projects                             List projects
  project <id-or-slug>                 View project details and DSN
  issues                               List issues (--all or --limit to paginate)
  issue <uuid>                         View issue details with latest event
  events <issue-uuid>                  List events for an issue
  event <event-id>                     View event details
  stacktrace <event-id>                Get event stacktrace (Markdown, or JSON with --json)
  releases                             List releases (--project optional)
  resolve <issue-uuid...>              Mark issue(s) RESOLVED (--next-release, --release <ver>)
  reopen <issue-uuid...>               Reopen issue(s) to OPEN
  mute <issue-uuid...>                 Mute issue(s)
  unmute <issue-uuid...>               Unmute issue(s) back to OPEN
  tracker-issue <issue-uuid>           Create or link a Tracker AI issue
  import-bugsink                       Import historical projects/issues/events from Bugsink

Common options:
  --json                               Output structured JSON
  --url <url>                          Override ERRORS_URL

Issue list options:
  --project <id-or-slug>               Filter by project ID or slug
  --tab <tab>                          unresolved | regressed | muted | resolved | all
  --state <state>                      OPEN | RESOLVED | RESOLVED_NEXT_RELEASE | MUTED
  --q <query>                          Search issue type, value, or transaction
  --limit <n>                          Maximum total items to return
  --all                                Follow nextCursor across all pages

Write options:
  --next-release                       (resolve) Mark RESOLVED_NEXT_RELEASE
  --release <ver>                      (resolve) Record resolvedInRelease version
  --title <text>                       (tracker-issue) Override Tracker issue title
  --urgency <high|medium|low>          (tracker-issue) Triage urgency
  --impact <high|medium|low>           (tracker-issue) Triage impact
  --effort <xs|s|m|l|xl>               (tracker-issue) Triage effort
  --base-url <url>                     (import-bugsink) Source Bugsink URL
  --concurrency <n>                    (import-bugsink) Fetch concurrency (1..32)
  --dry-run                            (import-bugsink) Preview import counts without writing

Environment:
  ERRORS_URL                           Default: https://errors.tailnet-1a49.ts.net
  ERRORS_TOKEN                         Optional Bearer token for machine requests
`;

const COMMON_OPTIONS = {
  json: { type: "boolean", default: false },
  url: { type: "string" },
} as const;

function isHelpRequested(subcommand: string, args: readonly string[]): boolean {
  return (
    subcommand.length === 0 ||
    subcommand === "--help" ||
    subcommand === "-h" ||
    args.includes("--help") ||
    args.includes("-h")
  );
}

function requireOnePositional(
  positionals: readonly string[],
  label: string,
  usage: string,
): string {
  const first = positionals[0];
  if (first === undefined || first.length === 0 || positionals.length > 1) {
    throw new Error(`${label} is required. Usage: ${usage}`);
  }
  return first;
}

function requirePositionals(
  positionals: readonly string[],
  label: string,
  usage: string,
): readonly string[] {
  const valid = positionals.filter((entry) => entry.length > 0);
  if (valid.length === 0) {
    throw new Error(`At least one ${label} is required. Usage: ${usage}`);
  }
  return valid;
}

function parseNonNegativeInt(
  raw: string | undefined,
  flagName: string,
): number | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!/^\d+$/u.test(raw)) {
    throw new Error(
      `Invalid ${flagName}: ${raw}. Expected a non-negative integer.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(
      `Invalid ${flagName}: ${raw}. Expected a safe integer.`,
    );
  }
  return parsed;
}

function parsePositiveInt(
  raw: string | undefined,
  flagName: string,
): number | undefined {
  const parsed = parseNonNegativeInt(raw, flagName);
  if (parsed !== undefined && parsed < 1) {
    throw new Error(
      `Invalid ${flagName}: ${String(raw)}. Expected a positive integer.`,
    );
  }
  return parsed;
}

function parseEnumFlag<T>(
  raw: string | undefined,
  schema: z.ZodType<T>,
  flagName: string,
): T | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid ${flagName}: ${raw}`);
  }
  return result.data;
}

async function runIssuesSubcommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      ...COMMON_OPTIONS,
      project: { type: "string" },
      tab: { type: "string" },
      state: { type: "string" },
      q: { type: "string" },
      limit: { type: "string" },
      all: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 0) {
    throw new Error(
      `Unexpected positional argument: ${positionals.join(" ")}. Usage: toolkit errors issues [options]`,
    );
  }
  await issuesCommand({
    json: values.json,
    baseUrl: values.url,
    project: values.project,
    tab: parseEnumFlag(values.tab, IssueFilterTabSchema, "--tab"),
    state: parseEnumFlag(values.state, IssueStateSchema, "--state"),
    q: values.q,
    limit: parseNonNegativeInt(values.limit, "--limit"),
    all: values.all,
  });
}

async function runResolveSubcommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      ...COMMON_OPTIONS,
      "next-release": { type: "boolean", default: false },
      release: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const ids = requirePositionals(
    positionals,
    "issue UUID",
    "toolkit errors resolve <issue-uuid...> [--next-release] [--release <ver>] [--json]",
  );
  const state = values["next-release"] ? "RESOLVED_NEXT_RELEASE" : "RESOLVED";
  await updateIssueStateCommand(ids, state, {
    json: values.json,
    baseUrl: values.url,
    resolvedInRelease: values.release,
  });
}

async function runBulkStateSubcommand(
  subcommand: "reopen" | "mute" | "unmute",
  args: string[],
): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: COMMON_OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  const ids = requirePositionals(
    positionals,
    "issue UUID",
    `toolkit errors ${subcommand} <issue-uuid...> [--json]`,
  );
  const state = subcommand === "mute" ? "MUTED" : "OPEN";
  await updateIssueStateCommand(ids, state, {
    json: values.json,
    baseUrl: values.url,
  });
}

async function runTrackerIssueSubcommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      ...COMMON_OPTIONS,
      title: { type: "string" },
      urgency: { type: "string" },
      impact: { type: "string" },
      effort: { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });
  const id = requireOnePositional(
    positionals,
    "Issue UUID",
    "toolkit errors tracker-issue <issue-uuid> [--title <t>] [--urgency high|medium|low] [--impact high|medium|low] [--effort xs|s|m|l|xl] [--json]",
  );
  await trackerIssueCommand(
    id,
    {
      title: values.title,
      urgency: parseEnumFlag(
        values.urgency?.toLowerCase(),
        TrackerTriageUrgencySchema,
        "--urgency",
      ),
      impact: parseEnumFlag(
        values.impact?.toLowerCase(),
        TrackerTriageImpactSchema,
        "--impact",
      ),
      effort: parseEnumFlag(
        values.effort?.toLowerCase(),
        TrackerTriageEffortSchema,
        "--effort",
      ),
    },
    { json: values.json, baseUrl: values.url },
  );
}

async function runImportBugsinkSubcommand(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      ...COMMON_OPTIONS,
      "base-url": { type: "string" },
      project: { type: "string" },
      concurrency: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 0) {
    throw new Error(
      `Unexpected positional argument: ${positionals.join(" ")}. Usage: toolkit errors import-bugsink [options]`,
    );
  }
  const concurrency = parsePositiveInt(values.concurrency, "--concurrency");
  if (concurrency !== undefined && concurrency > 32) {
    throw new Error(
      `Invalid --concurrency: ${String(concurrency)}. Expected an integer between 1 and 32.`,
    );
  }
  await importBugsinkCommand(
    {
      baseUrl: values["base-url"],
      projectId: parsePositiveInt(values.project, "--project"),
      concurrency,
      dryRun: values["dry-run"],
    },
    { json: values.json, baseUrl: values.url },
  );
}

async function runSimpleReadSubcommand(
  subcommand: string,
  args: string[],
): Promise<boolean> {
  switch (subcommand) {
    case "overview": {
      const { values } = parseArgs({
        args,
        options: COMMON_OPTIONS,
        strict: true,
      });
      await overviewCommand({ json: values.json, baseUrl: values.url });
      return true;
    }
    case "projects": {
      const { values } = parseArgs({
        args,
        options: COMMON_OPTIONS,
        strict: true,
      });
      await projectsCommand({ json: values.json, baseUrl: values.url });
      return true;
    }
    case "project": {
      const { values, positionals } = parseArgs({
        args,
        options: COMMON_OPTIONS,
        allowPositionals: true,
        strict: true,
      });
      const idOrSlug = requireOnePositional(
        positionals,
        "Project ID or slug",
        "toolkit errors project <id-or-slug> [--json]",
      );
      await projectCommand(idOrSlug, {
        json: values.json,
        baseUrl: values.url,
      });
      return true;
    }
    case "issue": {
      const { values, positionals } = parseArgs({
        args,
        options: COMMON_OPTIONS,
        allowPositionals: true,
        strict: true,
      });
      const id = requireOnePositional(
        positionals,
        "Issue UUID",
        "toolkit errors issue <uuid> [--json]",
      );
      await issueCommand(id, { json: values.json, baseUrl: values.url });
      return true;
    }
    case "events": {
      const { values, positionals } = parseArgs({
        args,
        options: { ...COMMON_OPTIONS, limit: { type: "string" } },
        allowPositionals: true,
        strict: true,
      });
      const issueId = requireOnePositional(
        positionals,
        "Issue UUID",
        "toolkit errors events <issue-uuid> [--limit <n>] [--json]",
      );
      await eventsCommand(issueId, {
        json: values.json,
        baseUrl: values.url,
        limit: parseNonNegativeInt(values.limit, "--limit"),
      });
      return true;
    }
    case "event": {
      const { values, positionals } = parseArgs({
        args,
        options: COMMON_OPTIONS,
        allowPositionals: true,
        strict: true,
      });
      const eventId = requireOnePositional(
        positionals,
        "Event ID",
        "toolkit errors event <event-id> [--json]",
      );
      await eventCommand(eventId, { json: values.json, baseUrl: values.url });
      return true;
    }
    case "stacktrace": {
      const { values, positionals } = parseArgs({
        args,
        options: COMMON_OPTIONS,
        allowPositionals: true,
        strict: true,
      });
      const eventId = requireOnePositional(
        positionals,
        "Event ID",
        "toolkit errors stacktrace <event-id> [--json]",
      );
      await stacktraceCommand(eventId, {
        json: values.json,
        baseUrl: values.url,
      });
      return true;
    }
    case "releases": {
      const { values } = parseArgs({
        args,
        options: { ...COMMON_OPTIONS, project: { type: "string" } },
        strict: true,
      });
      await releasesCommand({
        json: values.json,
        baseUrl: values.url,
        project: values.project,
      });
      return true;
    }
    default:
      return false;
  }
}

export async function dispatchErrorsSubcommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (subcommand === undefined || isHelpRequested(subcommand, args)) {
    console.log(HELP_TEXT.trim());
    return;
  }

  if (await runSimpleReadSubcommand(subcommand, args)) {
    return;
  }

  switch (subcommand) {
    case "issues":
      await runIssuesSubcommand(args);
      return;
    case "resolve":
      await runResolveSubcommand(args);
      return;
    case "reopen":
    case "mute":
    case "unmute":
      await runBulkStateSubcommand(subcommand, args);
      return;
    case "tracker-issue":
      await runTrackerIssueSubcommand(args);
      return;
    case "import-bugsink":
      await runImportBugsinkSubcommand(args);
      return;
    default:
      throw new Error(`Unknown errors subcommand: ${subcommand}`);
  }
}

export async function handleErrorsCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  try {
    await dispatchErrorsSubcommand(subcommand, args);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
