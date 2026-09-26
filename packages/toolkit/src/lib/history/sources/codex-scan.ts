import { INDEXED_MESSAGE_PARSE_LIMIT } from "@shepherdjerred/toolkit/lib/history/query/messages.ts";
import type { HistoryPaths } from "@shepherdjerred/toolkit/lib/history/paths.ts";
import {
  diffFiles,
  filesUnder,
  incrementalResult,
  pathExists,
  sourceResult,
  statFiles,
} from "@shepherdjerred/toolkit/lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryScanOptions,
  HistorySource,
  HistorySourceResult,
} from "@shepherdjerred/toolkit/lib/history/types.ts";
import {
  assembleCodexDocuments,
  hashCodexDocument,
  overlayAffectedThreads,
  type AssembledCodexDocuments,
} from "./codex-assemble.ts";
import { scanCodexCatalog } from "./codex-catalog.ts";
import { scanCodexHistoryJsonl } from "./codex-history.ts";
import {
  parseCodexRolloutUsage,
  usageByThreadFromFiles,
  type CodexSessionUsage,
} from "./codex-usage.ts";
import {
  codexThreadItems,
  codexThreadMessages,
  codexThreadSummaries,
  readCodex,
  threadSummarySignature,
  type CodexThreadBuild,
} from "./codex.ts";

type CodexScanCache = {
  /** Pre-parse file stats from the last successful scan. */
  readonly fileStats: ReadonlyMap<string, string>;
  /** Every session file's parsed thread and usage. */
  readonly sessionUsage: ReadonlyMap<string, CodexSessionUsage>;
  /** Watermark per thread-history database and thread. */
  readonly threadMeta: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Catalog overlay input per thread (last row wins). */
  readonly catalogOverlay: ReadonlyMap<string, string>;
  /** Hash of every non-thread document as last emitted. */
  readonly emittedHash: ReadonlyMap<string, string>;
};

function emptyCodexScanCache(): CodexScanCache {
  return {
    fileStats: new Map(),
    sessionUsage: new Map(),
    threadMeta: new Map(),
    catalogOverlay: new Map(),
    emittedHash: new Map(),
  };
}

type CodexFileLayout = {
  readonly threadFiles: readonly string[];
  readonly sessionFiles: readonly string[];
  readonly existingFiles: readonly string[];
};

async function codexFileLayout(paths: HistoryPaths): Promise<CodexFileLayout> {
  const historyFiles = await filesUnder(paths.codexDir);
  const threadFiles = historyFiles.filter((file) =>
    /thread_history_.*\.sqlite$/u.test(file),
  );
  const sessionFiles = await filesUnder(paths.codexSessionsDir, ".jsonl");
  const files = [
    ...threadFiles,
    paths.codexCatalogDb,
    paths.codexHistoryJsonl,
    ...sessionFiles,
  ].filter((file, index, all) => all.indexOf(file) === index);
  const existingFiles: string[] = [];
  for (const file of files) {
    if (await pathExists(file)) {
      existingFiles.push(file);
    }
  }
  return { threadFiles, sessionFiles, existingFiles };
}

async function parseChangedSessions(
  parseFiles: readonly string[],
  sessionUsage: Map<string, CodexSessionUsage>,
): Promise<ReadonlySet<string>> {
  const affected = new Set<string>();
  for (const file of parseFiles) {
    const before = sessionUsage.get(file)?.threadId ?? null;
    const parsed = await parseCodexRolloutUsage(file);
    sessionUsage.set(file, parsed);
    if (before !== null) {
      affected.add(before);
    }
    if (parsed.threadId !== null) {
      affected.add(parsed.threadId);
    }
  }
  return affected;
}

async function watermarkThreadDatabases(
  changedThreadFiles: readonly string[],
  threadMeta: Map<string, Map<string, string>>,
): Promise<ReadonlySet<string>> {
  const affected = new Set<string>();
  for (const file of changedThreadFiles) {
    const summaries = await codexThreadSummaries(file);
    const prior = threadMeta.get(file) ?? new Map<string, string>();
    const next = new Map<string, string>();
    for (const [threadId, summary] of summaries) {
      next.set(threadId, threadSummarySignature(summary));
      if (prior.get(threadId) !== next.get(threadId)) {
        affected.add(threadId);
      }
    }
    for (const threadId of prior.keys()) {
      if (!next.has(threadId)) {
        affected.add(threadId);
      }
    }
    threadMeta.set(file, next);
  }
  return affected;
}

function pruneThreadMeta(
  threadMeta: Map<string, Map<string, string>>,
  existingFiles: readonly string[],
): void {
  for (const file of threadMeta.keys()) {
    if (!existingFiles.includes(file)) {
      threadMeta.delete(file);
    }
  }
}

function collectIndexedThreads(
  threadMeta: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Set<string> {
  const indexedThreadIds = new Set<string>();
  for (const threads of threadMeta.values()) {
    for (const threadId of threads.keys()) {
      indexedThreadIds.add(threadId);
    }
  }
  return indexedThreadIds;
}

async function buildThreadDocuments(
  threadMeta: ReadonlyMap<string, ReadonlyMap<string, string>>,
  buildThreads: ReadonlySet<string> | null,
): Promise<readonly CodexThreadBuild[]> {
  const builds: CodexThreadBuild[] = [];
  const databases = [...threadMeta.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [file, threads] of databases) {
    const wanted =
      buildThreads === null
        ? [...threads.keys()].sort()
        : [...threads.keys()]
            .filter((threadId) => buildThreads.has(threadId))
            .sort();
    if (wanted.length === 0) {
      continue;
    }
    const targeted = buildThreads === null ? null : wanted;
    const items = await codexThreadItems(file, targeted);
    const messages = await codexThreadMessages(
      file,
      targeted,
      INDEXED_MESSAGE_PARSE_LIMIT,
    );
    for (const item of items) {
      builds.push({
        filePath: file,
        item,
        messages: messages.get(item.threadId) ?? [],
      });
    }
  }
  return builds;
}

function threadSourceIds(
  threadMeta: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string[] {
  return [...threadMeta.entries()].flatMap(([file, threads]) =>
    [...threads.keys()].map((threadId) => `${file}:${threadId}`),
  );
}

type CodexScanShape = {
  readonly layout: CodexFileLayout;
  readonly fingerprint: string;
  readonly signatures: ReadonlyMap<string, string>;
  readonly full: boolean;
  readonly changed: ReadonlySet<string>;
};

async function codexScanShape(
  paths: HistoryPaths,
  previous: CodexScanCache | null,
  force: boolean,
): Promise<CodexScanShape | null> {
  const layout = await codexFileLayout(paths);
  if (layout.existingFiles.length === 0) {
    return null;
  }
  const { fingerprint, signatures } = await statFiles(layout.existingFiles);
  const diff =
    force || previous === null
      ? null
      : diffFiles(previous.fileStats, signatures);
  // Any deletion falls back to a full re-parse (see scanClaude): usage
  // winners and owner chains are only sound against a complete picture.
  const full = diff === null || diff.deleted.length > 0;
  const changed =
    diff === null
      ? new Set<string>()
      : new Set([...diff.added, ...diff.changed]);
  return { layout, fingerprint, signatures, full, changed };
}

type FinishedCodexScan = {
  readonly result: HistorySourceResult;
  readonly cache: CodexScanCache;
};

function finishFullCodexScan(input: {
  readonly assembled: AssembledCodexDocuments;
  readonly sourceIds: readonly string[];
  readonly fingerprint: string;
  readonly signatures: ReadonlyMap<string, string>;
  readonly sessionUsage: ReadonlyMap<string, CodexSessionUsage>;
  readonly threadMeta: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly catalogOverlay: ReadonlyMap<string, string>;
}): FinishedCodexScan {
  const emittedHash = new Map<string, string>();
  for (const document of [
    ...input.assembled.catalogDocuments,
    ...input.assembled.historyDocuments,
    ...input.assembled.placeholderDocuments,
  ]) {
    emittedHash.set(document.sourceId, hashCodexDocument(document));
  }
  return {
    result: {
      source: "codex",
      available: true,
      documents: [
        ...input.assembled.threadDocuments,
        ...input.assembled.catalogDocuments,
        ...input.assembled.historyDocuments,
        ...input.assembled.placeholderDocuments,
      ],
      fingerprint: input.fingerprint,
      error: null,
      complete: true,
      sourceIds: [...input.sourceIds],
    },
    cache: {
      fileStats: new Map(input.signatures),
      sessionUsage: new Map(input.sessionUsage),
      threadMeta: new Map(input.threadMeta),
      catalogOverlay: new Map(input.catalogOverlay),
      emittedHash,
    },
  };
}

function finishIncrementalCodexScan(input: {
  readonly assembled: AssembledCodexDocuments;
  readonly sourceIds: readonly string[];
  readonly fingerprint: string;
  readonly signatures: ReadonlyMap<string, string>;
  readonly sessionUsage: ReadonlyMap<string, CodexSessionUsage>;
  readonly threadMeta: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly catalogOverlay: ReadonlyMap<string, string>;
  readonly previous: CodexScanCache | null;
}): FinishedCodexScan {
  const emittedHash = new Map(input.previous?.emittedHash);
  const documents: HistoryDocument[] = [...input.assembled.threadDocuments];
  for (const document of [
    ...input.assembled.catalogDocuments,
    ...input.assembled.historyDocuments,
    ...input.assembled.placeholderDocuments,
  ]) {
    const hash = hashCodexDocument(document);
    if (emittedHash.get(document.sourceId) !== hash) {
      emittedHash.set(document.sourceId, hash);
      documents.push(document);
    }
  }
  const liveIds = new Set(input.sourceIds);
  for (const sourceId of emittedHash.keys()) {
    if (!liveIds.has(sourceId)) {
      emittedHash.delete(sourceId);
    }
  }
  return {
    result: incrementalResult(
      "codex",
      documents,
      input.sourceIds,
      input.fingerprint,
    ),
    cache: {
      fileStats: new Map(input.signatures),
      sessionUsage: new Map(input.sessionUsage),
      threadMeta: new Map(input.threadMeta),
      catalogOverlay: new Map(input.catalogOverlay),
      emittedHash,
    },
  };
}

async function runCodexScan(
  paths: HistoryPaths,
  previous: CodexScanCache | null,
  shape: CodexScanShape,
): Promise<FinishedCodexScan> {
  const { layout, full, changed } = shape;
  const sessionUsage = new Map(previous?.sessionUsage);
  const threadMeta = new Map(
    [...(previous?.threadMeta ?? [])].map(
      ([file, threads]) => [file, new Map(threads)] as const,
    ),
  );
  const affectedThreads = new Set<string>();
  const parseSessions = full
    ? [...layout.sessionFiles]
    : [...changed].filter((file) => layout.sessionFiles.includes(file)).sort();
  if (full) {
    sessionUsage.clear();
  }
  for (const threadId of await parseChangedSessions(
    parseSessions,
    sessionUsage,
  )) {
    affectedThreads.add(threadId);
  }
  const usageByThread = usageByThreadFromFiles(sessionUsage);

  const changedThreadFiles = full
    ? layout.threadFiles.filter((file) => layout.existingFiles.includes(file))
    : [...changed].filter(
        (file) =>
          layout.threadFiles.includes(file) &&
          layout.existingFiles.includes(file),
      );
  for (const threadId of await watermarkThreadDatabases(
    changedThreadFiles,
    threadMeta,
  )) {
    affectedThreads.add(threadId);
  }
  if (full) {
    pruneThreadMeta(threadMeta, layout.existingFiles);
  }
  const indexedThreadIds = collectIndexedThreads(threadMeta);

  // The catalog and history prompt list are small metadata reads, so they
  // are re-parsed every scan; hash-diffing below emits only real changes.
  const catalogDocuments = (await pathExists(paths.codexCatalogDb))
    ? await scanCodexCatalog(paths.codexCatalogDb)
    : [];
  const historyDocuments = (await pathExists(paths.codexHistoryJsonl))
    ? await scanCodexHistoryJsonl(paths.codexHistoryJsonl)
    : [];
  const overlay = overlayAffectedThreads(
    catalogDocuments,
    previous?.catalogOverlay ?? new Map(),
  );
  if (!full) {
    // A changed catalog overlay alters the thread documents it decorates.
    for (const threadId of overlay.affected) {
      affectedThreads.add(threadId);
    }
  }

  const buildThreads = full
    ? null
    : new Set(
        [...affectedThreads].filter((threadId) =>
          indexedThreadIds.has(threadId),
        ),
      );
  const assembled = assembleCodexDocuments({
    threadBuilds: await buildThreadDocuments(threadMeta, buildThreads),
    indexedThreadIds,
    catalogDocuments,
    historyDocuments,
    usageByThread,
    sessionsDir: paths.codexSessionsDir,
  });
  // `sourceIds` must be exactly the ids of the documents that belong in
  // the index: catalog rows for threads that already have a thread-history
  // document are filtered out of the assembled set (their content overlays
  // the thread document instead), so the ids come from the assembled
  // outputs rather than the fresh parses.
  const sourceIds = [
    ...threadSourceIds(threadMeta),
    ...assembled.catalogDocuments.map((document) => document.sourceId),
    ...assembled.historyDocuments.map((document) => document.sourceId),
    ...assembled.placeholderDocuments.map((document) => document.sourceId),
  ];
  const finished = {
    assembled,
    sourceIds,
    fingerprint: shape.fingerprint,
    signatures: shape.signatures,
    sessionUsage,
    threadMeta,
    catalogOverlay: overlay.overlay,
  };
  return full
    ? finishFullCodexScan(finished)
    : finishIncrementalCodexScan({ ...finished, previous });
}

async function scanCodex(
  paths: HistoryPaths,
  previous: CodexScanCache | null,
  force: boolean,
): Promise<{
  readonly result: HistorySourceResult;
  readonly cache: CodexScanCache | null;
}> {
  const shape = await codexScanShape(paths, previous, force);
  if (shape === null) {
    return {
      result: await sourceResult("codex", [], () => []),
      cache: emptyCodexScanCache(),
    };
  }
  try {
    return await runCodexScan(paths, previous, shape);
  } catch (error: unknown) {
    return {
      result: {
        source: "codex",
        available: false,
        documents: [],
        fingerprint: shape.fingerprint,
        error: error instanceof Error ? error.message : String(error),
        complete: true,
        sourceIds: [],
      },
      cache: null,
    };
  }
}

export function createCodexSource(): HistorySource {
  let previous: CodexScanCache | null = null;
  return {
    name: "codex",
    label: "Codex",
    scan: async (paths: HistoryPaths, options?: HistoryScanOptions) => {
      const { result, cache } = await scanCodex(
        paths,
        previous,
        options?.force ?? false,
      );
      if (cache !== null) {
        previous = cache;
      }
      return result;
    },
    read: readCodex,
  };
}
