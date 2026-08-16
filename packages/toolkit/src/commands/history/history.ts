import { parseArgs } from "node:util";
import { HistoryIndex, parseLimit, parseSince } from "#lib/history/index.ts";
import {
  historyDaemonRequest,
  HistoryDaemonResponseSchema,
  HistoryDaemonStatusSchema,
  pathExists,
} from "#lib/history/ipc.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
} from "#lib/history/paths.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import { excerptForQuery } from "#lib/history/text.ts";
import type { HistoryRecord, HistorySourceName } from "#lib/history/types.ts";
import {
  HISTORY_LAUNCH_AGENT_LABEL,
  installLaunchAgent,
  launchAgentStatus,
  startLaunchAgent,
  stopLaunchAgent,
  uninstallLaunchAgent,
} from "#lib/history/launchd.ts";

const USAGE = `
toolkit history — search local agent conversation history

Search and browse the existing local index:
  toolkit history search <query> [--since 7d] [--source <name>] [--limit 20] [--include-excerpts] [--json]
  toolkit history recent [--since 7d] [--source <name>] [--limit 20] [--json]
  toolkit history sources [--json]

Manage background ingestion:
  toolkit history daemon install
  toolkit history daemon start|stop|uninstall|status|reindex

Sources: conductor, claude, codex, cursor, opencode-conductor, opencode-standalone
`;

function parseSource(value: string | undefined): HistorySourceName | null {
  if (value === undefined) {
    return null;
  }
  switch (value) {
    case "conductor":
    case "claude":
    case "codex":
    case "cursor":
    case "opencode-conductor":
    case "opencode-standalone":
      return value;
    default:
      throw new Error(
        `Unknown history source "${value}"; run 'toolkit history sources' for valid names`,
      );
  }
}

function parseCommon(args: string[]) {
  return parseArgs({
    args,
    options: {
      since: { type: "string" },
      source: { type: "string" },
      limit: { type: "string" },
      "include-excerpts": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
}

async function withReadOnlyIndex<T>(
  callback: (index: HistoryIndex) => Promise<T> | T,
): Promise<T> {
  const index = await HistoryIndex.open(
    defaultHistoryRuntimePaths(),
    true,
  ).catch((error: unknown) => {
    throw new Error(
      `History index is not available. Run 'toolkit history daemon install' and wait for its first scan. ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  });
  try {
    return await callback(index);
  } finally {
    index.close();
  }
}

async function addExcerpts(
  records: HistoryRecord[],
  query: string,
): Promise<HistoryRecord[]> {
  if (records.length === 0) {
    return records;
  }
  const paths = defaultHistoryPaths();
  const documents = new Map<string, string>();
  for (const source of createHistorySources()) {
    const result = await source.scan(paths);
    if (result.error !== null) {
      continue;
    }
    for (const document of result.documents) {
      documents.set(
        `${document.source}:${document.sourceId}`,
        document.searchText,
      );
    }
  }
  return records.map((record) => ({
    ...record,
    excerpt: excerptForQuery(
      documents.get(`${record.source}:${record.sourceId}`) ?? "",
      query,
    ),
  }));
}

function renderRecords(
  title: string,
  records: readonly HistoryRecord[],
): string {
  const lines = [`## ${title}`, ""];
  if (records.length === 0) {
    lines.push("No matching history.");
    return lines.join("\n");
  }
  for (const record of records) {
    lines.push(
      `- **${record.title}** — ${record.source} — ${record.updatedAt}`,
    );
    if (record.workspace !== null) {
      lines.push(`  Workspace: \`${record.workspace}\``);
    }
    lines.push(`  Source: \`${record.path}\` (${record.sourceId})`);
    if (record.excerpt !== null && record.excerpt.length > 0) {
      lines.push(`  Excerpt: ${record.excerpt}`);
    }
  }
  return lines.join("\n");
}

async function searchCommand(args: string[]): Promise<void> {
  const { values, positionals } = parseCommon(args);
  const query = positionals.join(" ").trim();
  if (query.length === 0) {
    throw new Error(
      "Search query is required. Usage: toolkit history search <query>",
    );
  }
  const source = parseSource(values.source);
  const since = parseSince(values.since);
  const limit = parseLimit(values.limit);
  const records = await withReadOnlyIndex((index) =>
    index.search(query, { since, source, limit }),
  );
  const enriched = values["include-excerpts"]
    ? await addExcerpts(records, query)
    : records;
  if (values.json) {
    console.log(JSON.stringify(enriched, null, 2));
    return;
  }
  console.log(renderRecords(`History search: ${query}`, enriched));
}

async function recentCommand(args: string[]): Promise<void> {
  const { values } = parseCommon(args);
  const source = parseSource(values.source);
  const since = parseSince(values.since);
  const limit = parseLimit(values.limit);
  const records = await withReadOnlyIndex((index) =>
    index.recent({ since, source, limit }),
  );
  if (values.json) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }
  console.log(renderRecords("Recent agent history", records));
}

async function sourcesCommand(args: string[]): Promise<void> {
  const { values } = parseCommon(args);
  const sourceDefinitions = createHistorySources();
  const labels = new Map(
    sourceDefinitions.map((source) => [source.name, source.label]),
  );
  const statuses = await withReadOnlyIndex((index) => index.statuses(labels));
  if (values.json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  console.log(
    renderRecords(
      "History sources",
      statuses.map((status) => ({
        id: 0,
        source: status.source,
        sourceId: status.source,
        title: status.label,
        path: status.error ?? (status.available ? "available" : "not found"),
        workspace: null,
        agent: `${String(status.indexedDocuments)} indexed`,
        createdAt: status.lastScanAt ?? "never",
        updatedAt: status.lastScanAt ?? "never",
        excerpt: null,
      })),
    ),
  );
}

async function daemonStatusCommand(json: boolean): Promise<void> {
  const runtimePaths = defaultHistoryRuntimePaths();
  const launchAgent = await launchAgentStatus(runtimePaths);
  const daemonRunning = await pathExists(runtimePaths.socket);
  const daemon: unknown = daemonRunning
    ? await historyDaemonRequest(
        runtimePaths,
        HistoryDaemonStatusSchema,
        "/status",
      )
    : null;
  const result = {
    launchAgent: { label: HISTORY_LAUNCH_AGENT_LABEL, ...launchAgent },
    daemon,
  };
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `LaunchAgent: ${launchAgent.installed ? "installed" : "not installed"} (${launchAgent.loaded ? "loaded" : "not loaded"})`,
  );
  if (daemon === null) {
    console.log("Daemon: not running");
  } else {
    const parsed = HistoryDaemonStatusSchema.parse(daemon);
    console.log(
      `Daemon: running (pid ${String(parsed.pid)}, last scan ${parsed.lastScanAt ?? "never"})`,
    );
    for (const source of parsed.sources) {
      console.log(
        `- ${source.label}: ${String(source.indexedDocuments)} indexed${source.error === null ? "" : `; error: ${source.error}`}`,
      );
    }
  }
}

async function daemonCommand(args: string[]): Promise<void> {
  const action = args[0] ?? "";
  const runtimePaths = defaultHistoryRuntimePaths();
  switch (action) {
    case "install":
      await installLaunchAgent(runtimePaths);
      break;
    case "start":
      await startLaunchAgent(runtimePaths);
      break;
    case "stop":
      await stopLaunchAgent(runtimePaths);
      break;
    case "uninstall":
      await uninstallLaunchAgent(runtimePaths);
      break;
    case "status": {
      const parsed = parseArgs({
        args: args.slice(1),
        options: { json: { type: "boolean", default: false } },
      });
      await daemonStatusCommand(parsed.values.json);
      break;
    }
    case "reindex":
      await historyDaemonRequest(
        runtimePaths,
        HistoryDaemonResponseSchema,
        "/reindex",
      );
      console.log("History reindex complete.");
      break;
    case "serve": {
      const { runHistoryDaemon } = await import("#lib/history/serve.ts");
      await runHistoryDaemon();
      break;
    }
    default:
      console.error(USAGE);
      process.exit(1);
  }
}

export async function handleHistoryCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  try {
    switch (subcommand) {
      case "search":
        await searchCommand(args);
        break;
      case "recent":
        await recentCommand(args);
        break;
      case "sources":
        await sourcesCommand(args);
        break;
      case "daemon":
        await daemonCommand(args);
        break;
      case undefined:
      case "help":
      case "--help":
        console.log(USAGE);
        break;
      default:
        console.error(`Unknown history subcommand: ${subcommand}`);
        console.error(USAGE);
        process.exit(1);
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
