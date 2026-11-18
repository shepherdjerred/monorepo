import { realpath } from "node:fs/promises";
import path from "node:path";
import type { HistoryPaths } from "#lib/history/paths.ts";
import {
  createClaudeSource,
  createHistorySources,
} from "#lib/history/sources.ts";
import { createAntigravitySource } from "#lib/history/sources/antigravity/antigravity.ts";
import { readAntigravitySummaries } from "#lib/history/sources/antigravity/antigravity-transcript.ts";
import { createCodexSource } from "#lib/history/sources/codex-scan.ts";
import { createCursorSource } from "#lib/history/sources/cursor.ts";
import { createGrokSource } from "#lib/history/sources/grok.ts";
import { createKimiSource } from "#lib/history/sources/kimi.ts";
import { createMuseSource } from "#lib/history/sources/muse.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistorySource,
  HistorySourceName,
} from "#lib/history/types.ts";
import { TakeoverError } from "./errors.ts";
import {
  BRIM_HISTORY_SOURCES,
  localBrimHistorySource,
  type BrimHistorySourceName,
} from "./providers.ts";

export type SessionCandidate = {
  readonly historyId: number | null;
  readonly source: BrimHistorySourceName;
  readonly sourceId: string;
  readonly title: string;
  readonly path: string;
  readonly workspace: string;
  readonly gitBranch: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly openingPromptHash: string | null;
  readonly record: HistoryRecord;
};

export function trimTrailingSeparators(value: string): string {
  const normalized = path.resolve(value);
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : normalized;
}

export async function canonicalPath(
  target: string,
  cache: Map<string, string>,
): Promise<string> {
  const resolved = trimTrailingSeparators(target);
  const cached = cache.get(resolved);
  if (cached !== undefined) {
    return cached;
  }
  let real: string;
  try {
    real = trimTrailingSeparators(await realpath(resolved));
  } catch {
    real = resolved;
  }
  cache.set(resolved, real);
  cache.set(real, real);
  return real;
}

export async function normalizeWorkspacePaths(
  rawCwd: string,
  cache: Map<string, string>,
): Promise<readonly string[]> {
  const resolved = trimTrailingSeparators(rawCwd);
  const real = await canonicalPath(resolved, cache);
  return resolved === real ? [resolved] : [resolved, real];
}

function createLocalBrimSource(name: BrimHistorySourceName): HistorySource {
  switch (name) {
    case "claude":
      return createClaudeSource();
    case "codex":
      return createCodexSource();
    case "antigravity":
      return createAntigravitySource();
    case "cursor":
      return createCursorSource();
    case "grok":
      return createGrokSource();
    case "kimi":
      return createKimiSource();
    case "muse":
      return createMuseSource();
  }
}

function resolveSourceAdapter(
  sourceName: HistorySourceName,
  customSources?: readonly HistorySource[],
): HistorySource {
  if (customSources !== undefined) {
    const custom = customSources.find((entry) => entry.name === sourceName);
    if (custom !== undefined) {
      return custom;
    }
  }
  const local = localBrimHistorySource(sourceName);
  if (local !== null) {
    return createLocalBrimSource(local);
  }
  const adapter = createHistorySources().find(
    (entry) => entry.name === sourceName,
  );
  if (adapter === undefined) {
    throw new TakeoverError(
      `No history source adapter exists for "${sourceName}".`,
    );
  }
  return adapter;
}

export async function readRecordMessages(
  record: HistoryRecord,
  historyPaths: HistoryPaths,
  customSources?: readonly HistorySource[],
): Promise<readonly HistoryMessage[] | null> {
  const source = resolveSourceAdapter(record.source, customSources);
  const result = await source.read(historyPaths, [record]);
  if (result.error !== null) {
    throw new TakeoverError(
      `Failed to read ${source.label} transcript for ${record.sourceId}: ${result.error}`,
    );
  }
  return result.missingSourceIds.includes(record.sourceId)
    ? null
    : (result.messages.get(record.sourceId) ?? null);
}

function sourcesForDirectScan(
  targetSource: BrimHistorySourceName | null,
  customSources?: readonly HistorySource[],
): readonly HistorySource[] {
  if (customSources !== undefined) {
    return customSources.filter((entry) => {
      const local = localBrimHistorySource(entry.name);
      return (
        local !== null && (targetSource === null || local === targetSource)
      );
    });
  }
  return targetSource === null
    ? BRIM_HISTORY_SOURCES.map((name) => createLocalBrimSource(name))
    : [createLocalBrimSource(targetSource)];
}

function documentToCandidate(
  doc: HistoryDocument,
  localSource: BrimHistorySourceName,
  existingId: number | null,
): SessionCandidate {
  const workspace = doc.workspace ?? "";
  return {
    historyId: existingId,
    source: localSource,
    sourceId: doc.sourceId,
    title: doc.title,
    path: doc.path,
    workspace,
    gitBranch: doc.gitBranch,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    openingPromptHash: doc.openingPromptHash,
    record: {
      id: existingId ?? 0,
      source: localSource,
      sourceId: doc.sourceId,
      title: doc.title,
      path: doc.path,
      workspace: doc.workspace,
      agent: doc.agent,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      excerpt: null,
    },
  };
}

export async function readAntigravitySubagentIds(
  roots: readonly string[],
): Promise<ReadonlySet<string>> {
  const ids = new Set<string>();
  for (const root of roots) {
    try {
      const summaries = await readAntigravitySummaries(root);
      for (const [conversationId, summary] of summaries) {
        if (summary.isSubagent) {
          ids.add(conversationId);
        }
      }
    } catch {
      // Ignore unreadable or missing summary databases during takeover lookup.
    }
  }
  return ids;
}

export function isAntigravitySubagentCandidate(
  candidate: Pick<SessionCandidate, "source" | "sourceId">,
  subagentIds: ReadonlySet<string>,
): boolean {
  return (
    candidate.source === "antigravity" &&
    subagentIds.has(path.basename(candidate.sourceId, ".db"))
  );
}

async function documentMatchesTarget(options: {
  readonly doc: HistoryDocument;
  readonly canonicalTarget: string;
  readonly terminalPromptHash: string | null;
  readonly pathCache: Map<string, string>;
}): Promise<boolean> {
  const { doc, canonicalTarget, terminalPromptHash, pathCache } = options;
  if (doc.workspace !== null && doc.workspace.length > 0) {
    const docCanonical = await canonicalPath(doc.workspace, pathCache);
    return docCanonical === canonicalTarget;
  }
  return (
    terminalPromptHash !== null && doc.openingPromptHash === terminalPromptHash
  );
}

export async function scanWorkspaceSources(options: {
  readonly historyPaths: HistoryPaths;
  readonly canonicalTarget: string;
  readonly fallbackWorkspace: string;
  readonly terminalPromptHash: string | null;
  readonly targetSource: BrimHistorySourceName | null;
  readonly indexedByKey: ReadonlyMap<string, SessionCandidate>;
  readonly pathCache: Map<string, string>;
  readonly customSources?: readonly HistorySource[];
}): Promise<readonly SessionCandidate[]> {
  const adapters = sourcesForDirectScan(
    options.targetSource,
    options.customSources,
  );
  const scanResults = await Promise.all(
    adapters.map((adapter) =>
      adapter.scan(options.historyPaths, { force: true }),
    ),
  );
  const matched: SessionCandidate[] = [];
  for (const result of scanResults) {
    const localSource = localBrimHistorySource(result.source);
    if (localSource === null) {
      continue;
    }
    for (const doc of result.documents) {
      const matches = await documentMatchesTarget({
        doc,
        canonicalTarget: options.canonicalTarget,
        terminalPromptHash: options.terminalPromptHash,
        pathCache: options.pathCache,
      });
      if (!matches) {
        continue;
      }
      const key = `${localSource}:${doc.sourceId}`;
      const existing = options.indexedByKey.get(key);
      const effectiveDoc =
        doc.workspace === null
          ? { ...doc, workspace: options.fallbackWorkspace }
          : doc;
      matched.push(
        documentToCandidate(
          effectiveDoc,
          localSource,
          existing?.historyId ?? null,
        ),
      );
    }
  }
  return matched;
}
