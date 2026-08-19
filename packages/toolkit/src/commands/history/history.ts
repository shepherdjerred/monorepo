import { parseArgs } from "node:util";
import { parseMessageLimit, selectShowMessages } from "#lib/history/context.ts";
import { HistoryIndex } from "#lib/history/index.ts";
import { ftsQuery, parseLimit, parseSince } from "#lib/history/query.ts";
import {
  historyDaemonRequest,
  HistoryDaemonResponseSchema,
  HistoryDaemonStatusSchema,
  pathExists,
} from "#lib/history/ipc.ts";
import {
  HISTORY_LAUNCH_AGENT_LABEL,
  installLaunchAgent,
  launchAgentStatus,
  startLaunchAgent,
  stopLaunchAgent,
  uninstallLaunchAgent,
} from "#lib/history/launchd.ts";
import { defaultHistoryRuntimePaths } from "#lib/history/paths.ts";
import {
  collectHistoryResults,
  publicRecord,
  sourceWarnings,
} from "#lib/history/results.ts";
import {
  printHistoryWarnings,
  renderHistoryRecords,
  renderHistoryShow,
} from "#lib/history/render.ts";
import { currentHistoryRuntimes } from "#lib/history/runtime.ts";
import { createHistorySources } from "#lib/history/sources.ts";
import { addExcerpts, targetedMessages } from "#lib/history/targeted.ts";
import type { HistorySourceName } from "#lib/history/types.ts";

const USAGE = `
toolkit history — search local agent conversation history

Search and browse the existing local index:
  toolkit history search <query> [--since 7d] [--source <name>] [--limit 20] [--include-excerpts] [--include-current] [--include-duplicates] [--json]
  toolkit history recent [--since 7d] [--source <name>] [--limit 20] [--include-current] [--include-duplicates] [--json]
  toolkit history show <id> [--query <text>] [--messages 8] [--include-tools] [--json]
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
      "include-current": { type: "boolean", default: false },
      "include-duplicates": { type: "boolean", default: false },
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

function sourceDefinitions() {
  return createHistorySources();
}

function sourceLabels() {
  return new Map(
    sourceDefinitions().map((source) => [source.name, source.label]),
  );
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
  const runtimes = currentHistoryRuntimes();
  const resultOptions = {
    includeCurrent: values["include-current"],
    includeDuplicates: values["include-duplicates"],
    currentRuntimes: runtimes,
    limit,
  };
  const excludedRuntimes = values["include-current"] ? [] : runtimes;
  const indexed = await withReadOnlyIndex((index) =>
    index.readSnapshot(() => ({
      results: collectHistoryResults(
        (offset, pageLimit) =>
          index.search(query, {
            since,
            source,
            limit: pageLimit,
            offset,
            excludedRuntimes,
          }),
        (openingPromptHash) =>
          index.recent({
            since,
            source,
            openingPromptHash,
            excludedRuntimes,
          }),
        resultOptions,
      ),
      statuses: index.statuses(sourceLabels()),
    })),
  );
  const enriched = values["include-excerpts"]
    ? await addExcerpts(indexed.results, query)
    : { results: indexed.results, warnings: [] };
  const warnings = [
    ...sourceWarnings(indexed.statuses, source),
    ...enriched.warnings,
  ];
  if (values.json) {
    console.log(
      JSON.stringify({ query, results: enriched.results, warnings }, null, 2),
    );
    return;
  }
  printHistoryWarnings(warnings);
  console.log(
    renderHistoryRecords(`History search: ${query}`, enriched.results),
  );
}

async function recentCommand(args: string[]): Promise<void> {
  const { values } = parseCommon(args);
  const source = parseSource(values.source);
  const since = parseSince(values.since);
  const limit = parseLimit(values.limit);
  const runtimes = currentHistoryRuntimes();
  const resultOptions = {
    includeCurrent: values["include-current"],
    includeDuplicates: values["include-duplicates"],
    currentRuntimes: runtimes,
    limit,
  };
  const excludedRuntimes = values["include-current"] ? [] : runtimes;
  const indexed = await withReadOnlyIndex((index) =>
    index.readSnapshot(() => ({
      results: collectHistoryResults(
        (offset, pageLimit) =>
          index.recent({
            since,
            source,
            limit: pageLimit,
            offset,
            excludedRuntimes,
          }),
        (openingPromptHash) =>
          index.recent({
            since,
            source,
            openingPromptHash,
            excludedRuntimes,
          }),
        resultOptions,
      ),
      statuses: index.statuses(sourceLabels()),
    })),
  );
  const warnings = sourceWarnings(indexed.statuses, source);
  if (values.json) {
    console.log(
      JSON.stringify({ results: indexed.results, warnings }, null, 2),
    );
    return;
  }
  printHistoryWarnings(warnings);
  console.log(renderHistoryRecords("Recent agent history", indexed.results));
}

function parseShowId(value: string | undefined): number {
  if (value === undefined || !/^[1-9]\d*$/u.test(value)) {
    throw new RangeError(
      "A positive local index ID is required. Usage: toolkit history show <id>",
    );
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) {
    throw new RangeError(
      "A positive local index ID is required. Usage: toolkit history show <id>",
    );
  }
  return id;
}

async function showCommand(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      query: { type: "string" },
      messages: { type: "string" },
      "include-tools": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  const id = parseShowId(parsed.positionals[0]);
  if (parsed.positionals.length > 1) {
    throw new Error("show accepts exactly one local index ID");
  }
  const query = parsed.values.query ?? null;
  if (query !== null) {
    ftsQuery(query);
  }
  const record = await withReadOnlyIndex((index) => index.record(id));
  if (record === null) {
    throw new Error(
      `History record ${String(id)} no longer exists. Local index IDs can change after a rebuild; rerun 'toolkit history search' and use the new ID.`,
    );
  }
  const targeted = await targetedMessages([publicRecord(record)]);
  if (targeted.warnings.length > 0) {
    throw new Error(
      targeted.warnings.map((warning) => warning.message).join("; "),
    );
  }
  const selected = selectShowMessages(
    targeted.messages.get(`${record.source}:${record.sourceId}`) ?? [],
    {
      query,
      messageLimit: parseMessageLimit(parsed.values.messages),
      includeTools: parsed.values["include-tools"],
    },
  );
  const visibleRecord = publicRecord(record);
  if (parsed.values.json) {
    console.log(
      JSON.stringify(
        {
          record: visibleRecord,
          messages: selected.messages,
          truncated: selected.truncated,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    renderHistoryShow(visibleRecord, selected.messages, selected.truncated),
  );
}

async function sourcesCommand(args: string[]): Promise<void> {
  const { values } = parseCommon(args);
  const statuses = await withReadOnlyIndex((index) =>
    index.statuses(sourceLabels()),
  );
  if (values.json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }
  const lines = ["## History sources", ""];
  for (const status of statuses) {
    lines.push(
      `- **${status.label}** — ${status.available ? "available" : "unavailable"} — ${String(status.indexedDocuments)} indexed`,
    );
    if (status.error !== null) {
      lines.push(`  Error: ${status.error}`);
    }
  }
  console.log(lines.join("\n"));
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
      console.log("History reindex requested.");
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
      case "show":
        await showCommand(args);
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
