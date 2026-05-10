import { parseArgs } from "node:util";
import { issuesCommand } from "#commands/bugsink/issues.ts";
import { issueCommand } from "#commands/bugsink/issue.ts";
import { teamsCommand, teamCommand } from "#commands/bugsink/teams.ts";
import { projectsCommand, projectCommand } from "#commands/bugsink/projects.ts";
import { eventsCommand, eventCommand } from "#commands/bugsink/events.ts";
import { stacktraceCommand } from "#commands/bugsink/stacktrace.ts";
import { releasesCommand, releaseCommand } from "#commands/bugsink/releases.ts";

function parseJsonFlag(args: string[]) {
  return parseArgs({
    args,
    options: { json: { type: "boolean", default: false } },
    allowPositionals: true,
  });
}

function requirePositional(
  positionals: string[],
  name: string,
  usage: string,
): string {
  const val = positionals[0];
  if (val == null || val.length === 0) {
    console.error(`Error: ${name} is required`);
    console.error(`Usage: ${usage}`);
    process.exit(1);
  }
  return val;
}

async function handleIssues(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      project: { type: "string" },
      limit: { type: "string" },
    },
    allowPositionals: true,
  });
  const limit =
    values.limit != null && values.limit.length > 0
      ? Number.parseInt(values.limit, 10)
      : undefined;
  await issuesCommand({ json: values.json, project: values.project, limit });
}

async function handleIssue(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const id = requirePositional(
    positionals,
    "Issue ID",
    "tools bugsink issue <issue-id> [--json]",
  );
  await issueCommand(id, { json: values.json });
}

async function handleTeams(args: string[]): Promise<void> {
  const { values } = parseJsonFlag(args);
  await teamsCommand({ json: values.json });
}

async function handleTeam(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uuid = requirePositional(
    positionals,
    "Team UUID",
    "tools bugsink team <uuid> [--json]",
  );
  await teamCommand(uuid, { json: values.json });
}

async function handleProjects(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      team: { type: "string" },
    },
    allowPositionals: true,
  });
  await projectsCommand({ json: values.json, team: values.team });
}

async function handleProject(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const id = requirePositional(
    positionals,
    "Project ID",
    "tools bugsink project <id> [--json]",
  );
  await projectCommand(Number.parseInt(id, 10), { json: values.json });
}

async function handleEvents(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uuid = requirePositional(
    positionals,
    "Issue UUID",
    "tools bugsink events <issue-uuid> [--json]",
  );
  await eventsCommand(uuid, { json: values.json });
}

async function handleEvent(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uuid = requirePositional(
    positionals,
    "Event UUID",
    "tools bugsink event <uuid> [--json]",
  );
  await eventCommand(uuid, { json: values.json });
}

async function handleStacktrace(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uuid = requirePositional(
    positionals,
    "Event UUID",
    "tools bugsink stacktrace <event-uuid> [--json]",
  );
  await stacktraceCommand(uuid, { json: values.json });
}

async function handleReleases(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      project: { type: "string" },
    },
    allowPositionals: true,
  });
  const project =
    values.project != null && values.project.length > 0
      ? Number.parseInt(values.project, 10)
      : undefined;
  await releasesCommand({ json: values.json, project });
}

async function handleRelease(args: string[]): Promise<void> {
  const { values, positionals } = parseJsonFlag(args);
  const uuid = requirePositional(
    positionals,
    "Release UUID",
    "tools bugsink release <uuid> [--json]",
  );
  await releaseCommand(uuid, { json: values.json });
}

export async function handleBugsinkCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  if (
    subcommand == null ||
    subcommand.length === 0 ||
    subcommand === "--help" ||
    subcommand === "-h"
  ) {
    console.log(`
tools bugsink - Bugsink error tracking

Subcommands:
  issues                List unresolved issues
  issue <ID>            View issue details with latest event
  teams                 List teams
  team <UUID>           View team details
  projects              List projects
  project <ID>          View project details
  events <ISSUE_UUID>   List events for an issue
  event <UUID>          View event details
  stacktrace <EVT_UUID> Get event stacktrace (markdown)
  releases              List releases
  release <UUID>        View release details

Options:
  --json                Output as JSON
  --project <slug>      (issues) Filter by project slug
  --team <uuid>         (projects) Filter by team UUID
  --limit <n>           Maximum number of results

Environment:
  BUGSINK_URL           Required. Your Bugsink instance URL.
  BUGSINK_TOKEN         Required. Your Bugsink API token.

Examples:
  tools bugsink issues
  tools bugsink issue 12345678
  tools bugsink issues --project my-app
  tools bugsink teams
  tools bugsink projects --team <uuid>
  tools bugsink events <issue-uuid>
  tools bugsink stacktrace <event-uuid>
  tools bugsink releases --project 1
`);
    process.exit(0);
  }

  switch (subcommand) {
    case "issues":
      await handleIssues(args);
      break;
    case "issue":
      await handleIssue(args);
      break;
    case "teams":
      await handleTeams(args);
      break;
    case "team":
      await handleTeam(args);
      break;
    case "projects":
      await handleProjects(args);
      break;
    case "project":
      await handleProject(args);
      break;
    case "events":
      await handleEvents(args);
      break;
    case "event":
      await handleEvent(args);
      break;
    case "stacktrace":
      await handleStacktrace(args);
      break;
    case "releases":
      await handleReleases(args);
      break;
    case "release":
      await handleRelease(args);
      break;
    default:
      console.error(`Unknown bugsink subcommand: ${subcommand}`);
      process.exit(1);
  }
}
