import { HistoryIndex } from "#lib/history/index.ts";
import {
  defaultHistoryPaths,
  defaultHistoryRuntimePaths,
  type HistoryPaths,
  type HistoryRuntimePaths,
} from "#lib/history/paths.ts";
import type {
  HistoryMessage,
  HistorySource,
  HistorySourceName,
} from "#lib/history/types.ts";
import { TakeoverError } from "./errors.ts";
import {
  historySourceForProvider,
  localBrimHistorySource,
  providerForHistorySource,
  takeoverDisplayName,
  type BrimHistorySourceName,
  type BrimProviderId,
} from "./providers.ts";
import {
  canonicalPath,
  isAntigravitySubagentCandidate,
  normalizeWorkspacePaths,
  readAntigravitySubagentIds,
  readRecordMessages,
  scanWorkspaceSources,
  trimTrailingSeparators,
  type SessionCandidate,
} from "./resolve-sources.ts";
import type { InspectedTerminal } from "./terminal.ts";

const FRESHNESS_SLACK_MS = 15_000;
const INDEX_CANDIDATE_LIMIT = 50;

export type ResolveSessionOptions = {
  readonly historyId?: number;
  readonly cwd?: string;
  readonly fromProvider?: BrimProviderId;
  readonly terminal?: InspectedTerminal | null;
  readonly historyPaths?: HistoryPaths;
  readonly runtimePaths?: HistoryRuntimePaths;
  readonly sources?: readonly HistorySource[];
};

export type ResolvedTakeoverSession = {
  readonly sourceProvider: BrimProviderId;
  readonly sourceDisplayName: string;
  readonly historySource: HistorySourceName;
  readonly historyId: number | null;
  readonly sourceId: string;
  readonly title: string;
  readonly cwd: string;
  readonly gitBranch: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly rawTranscriptPath: string;
  readonly messages: readonly HistoryMessage[];
};

function readIndexedRecordById(
  index: HistoryIndex,
  historyId: number,
): {
  readonly record: NonNullable<ReturnType<HistoryIndex["record"]>> | null;
  readonly gitBranch: string | null;
} {
  const record = index.record(historyId);
  const gitBranch = index.sessionsByIds([historyId])[0]?.gitBranch ?? null;
  return { record, gitBranch };
}

async function resolveByHistoryId(
  historyId: number,
  options: ResolveSessionOptions,
  historyPaths: HistoryPaths,
  runtimePaths: HistoryRuntimePaths,
): Promise<ResolvedTakeoverSession> {
  if (!(await Bun.file(runtimePaths.indexDb).exists())) {
    throw new TakeoverError(
      `History index not found at ${runtimePaths.indexDb}; cannot look up session ID ${String(historyId)}.`,
    );
  }
  const index = await HistoryIndex.open(runtimePaths, true);
  let lookup: ReturnType<typeof readIndexedRecordById>;
  try {
    lookup = readIndexedRecordById(index, historyId);
  } finally {
    index.close();
  }
  const { record, gitBranch } = lookup;
  if (record === null) {
    throw new TakeoverError(
      `History session ${String(historyId)} was not found in the history index.`,
    );
  }
  const sourceProvider = providerForHistorySource(record.source);
  if (sourceProvider === null) {
    throw new TakeoverError(
      `History session ${String(historyId)} belongs to source "${record.source}", which is not a Brim subscription provider.`,
    );
  }
  if (
    options.fromProvider !== undefined &&
    options.fromProvider !== sourceProvider
  ) {
    throw new TakeoverError(
      `History session ${String(historyId)} belongs to ${sourceProvider}, not --from ${options.fromProvider}.`,
    );
  }
  const messages = await readRecordMessages(
    record,
    historyPaths,
    options.sources,
  );
  if (messages === null) {
    throw new TakeoverError(
      `Raw transcript for history session ${String(historyId)} (${record.path}) is no longer readable on disk.`,
    );
  }
  const cwd = trimTrailingSeparators(
    options.cwd ?? options.terminal?.cwd ?? record.workspace ?? process.cwd(),
  );
  return {
    sourceProvider,
    sourceDisplayName: takeoverDisplayName(sourceProvider),
    historySource: record.source,
    historyId: record.id,
    sourceId: record.sourceId,
    title: record.title,
    cwd,
    gitBranch,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    rawTranscriptPath: record.path,
    messages,
  };
}

async function matchingIndexedWorkspaces(
  index: HistoryIndex,
  directWorkspaces: readonly string[],
  canonicalTarget: string,
  pathCache: Map<string, string>,
): Promise<readonly string[]> {
  const seen = new Set(directWorkspaces);
  for (const facet of index.facets().workspaces) {
    if (facet.key === null || seen.has(facet.key)) {
      continue;
    }
    const canonical = await canonicalPath(facet.key, pathCache);
    if (canonical === canonicalTarget) {
      seen.add(facet.key);
    }
  }
  return [...seen];
}

function collectIndexSessionsForWorkspaces(
  index: HistoryIndex,
  workspaces: readonly string[],
  targetSource: BrimHistorySourceName | null,
): SessionCandidate[] {
  const byId = new Map<number, SessionCandidate>();
  for (const workspace of workspaces) {
    const page = index.sessions({
      since: null,
      source: targetSource,
      machine: "local",
      workspace,
      limit: INDEX_CANDIDATE_LIMIT,
      offset: 0,
    });
    for (const session of page.sessions) {
      if (byId.has(session.id)) {
        continue;
      }
      const localSource = localBrimHistorySource(session.source);
      const record = localSource === null ? null : index.record(session.id);
      if (localSource === null || record === null) {
        continue;
      }
      byId.set(session.id, {
        historyId: session.id,
        source: localSource,
        sourceId: record.sourceId,
        title: record.title,
        path: record.path,
        workspace: record.workspace ?? workspace,
        gitBranch: session.gitBranch,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        openingPromptHash: record.openingPromptHash,
        record,
      });
    }
  }
  return [...byId.values()];
}

async function queryIndexedWorkspaceCandidates(options: {
  readonly runtimePaths: HistoryRuntimePaths;
  readonly workspaces: readonly string[];
  readonly canonicalTarget: string;
  readonly targetSource: BrimHistorySourceName | null;
  readonly pathCache: Map<string, string>;
}): Promise<{
  readonly opened: boolean;
  readonly candidates: readonly SessionCandidate[];
}> {
  if (!(await Bun.file(options.runtimePaths.indexDb).exists())) {
    return { opened: false, candidates: [] };
  }
  let index: HistoryIndex;
  try {
    index = await HistoryIndex.open(options.runtimePaths, true);
  } catch {
    return { opened: false, candidates: [] };
  }
  try {
    const direct = collectIndexSessionsForWorkspaces(
      index,
      options.workspaces,
      options.targetSource,
    );
    if (direct.length > 0) {
      return { opened: true, candidates: direct };
    }
    const expanded = await matchingIndexedWorkspaces(
      index,
      options.workspaces,
      options.canonicalTarget,
      options.pathCache,
    );
    return expanded.length === options.workspaces.length
      ? { opened: true, candidates: [] }
      : {
          opened: true,
          candidates: collectIndexSessionsForWorkspaces(
            index,
            expanded,
            options.targetSource,
          ),
        };
  } finally {
    index.close();
  }
}

function needsDirectSourceScan(
  opened: boolean,
  candidates: readonly SessionCandidate[],
  terminal: InspectedTerminal | null,
): boolean {
  if (!opened || candidates.length === 0) {
    return true;
  }
  if (
    terminal?.promptHash != null &&
    !candidates.some((entry) => entry.openingPromptHash === terminal.promptHash)
  ) {
    return true;
  }
  if (terminal?.createdMs != null) {
    const cutoff = terminal.createdMs - FRESHNESS_SLACK_MS;
    const hasFresh = candidates.some((entry) => {
      const createdMs = Date.parse(entry.createdAt);
      return Number.isFinite(createdMs) && createdMs >= cutoff;
    });
    return !hasFresh;
  }
  return false;
}

function mergeCandidates(
  indexed: readonly SessionCandidate[],
  scanned: readonly SessionCandidate[],
): SessionCandidate[] {
  const merged = new Map<string, SessionCandidate>();
  for (const entry of indexed) {
    merged.set(`${entry.source}:${entry.sourceId}`, entry);
  }
  for (const entry of scanned) {
    merged.set(`${entry.source}:${entry.sourceId}`, entry);
  }
  return [...merged.values()];
}

function compareCreatedProximity(
  aCreatedAt: string,
  bCreatedAt: string,
  terminalCreatedMs: number,
): number {
  const cutoff = terminalCreatedMs - FRESHNESS_SLACK_MS;
  const aMs = Date.parse(aCreatedAt);
  const bMs = Date.parse(bCreatedAt);
  const aFresh = Number.isFinite(aMs) && aMs >= cutoff;
  const bFresh = Number.isFinite(bMs) && bMs >= cutoff;
  if (aFresh !== bFresh) {
    return aFresh ? -1 : 1;
  }
  if (aFresh && bFresh) {
    const aDelta = Math.abs(aMs - terminalCreatedMs);
    const bDelta = Math.abs(bMs - terminalCreatedMs);
    if (aDelta !== bDelta) {
      return aDelta - bDelta;
    }
  }
  return 0;
}

function compareUpdatedDesc(a: SessionCandidate, b: SessionCandidate): number {
  const aMs = Date.parse(a.updatedAt);
  const bMs = Date.parse(b.updatedAt);
  if (aMs !== bMs && Number.isFinite(aMs) && Number.isFinite(bMs)) {
    return bMs - aMs;
  }
  const byIso = b.updatedAt.localeCompare(a.updatedAt);
  return byIso === 0 ? a.sourceId.localeCompare(b.sourceId) : byIso;
}

export function compareSessionCandidates(
  a: SessionCandidate,
  b: SessionCandidate,
  terminal: InspectedTerminal | null,
): number {
  if (terminal?.promptHash != null) {
    const aMatch = a.openingPromptHash === terminal.promptHash ? 1 : 0;
    const bMatch = b.openingPromptHash === terminal.promptHash ? 1 : 0;
    if (aMatch !== bMatch) {
      return bMatch - aMatch;
    }
  }
  if (terminal?.createdMs != null) {
    const byCreated = compareCreatedProximity(
      a.createdAt,
      b.createdAt,
      terminal.createdMs,
    );
    if (byCreated !== 0) {
      return byCreated;
    }
  }
  return compareUpdatedDesc(a, b);
}

async function rankWorkspaceCandidates(options: {
  readonly indexed: readonly SessionCandidate[];
  readonly scanned: readonly SessionCandidate[];
  readonly targetSource: BrimHistorySourceName | null;
  readonly antigravityRoots: readonly string[];
  readonly terminal: InspectedTerminal | null;
}): Promise<SessionCandidate[]> {
  const subagentIds =
    options.targetSource === null || options.targetSource === "antigravity"
      ? await readAntigravitySubagentIds(options.antigravityRoots)
      : new Set<string>();
  const merged = mergeCandidates(options.indexed, options.scanned);
  const nonSubagent =
    subagentIds.size > 0
      ? merged.filter(
          (candidate) =>
            !isAntigravitySubagentCandidate(candidate, subagentIds),
        )
      : merged;
  return (nonSubagent.length > 0 ? nonSubagent : merged).sort((a, b) =>
    compareSessionCandidates(a, b, options.terminal),
  );
}

async function firstReadableSession(options: {
  readonly ranked: readonly SessionCandidate[];
  readonly resolvedCwd: string;
  readonly historyPaths: HistoryPaths;
  readonly sources?: readonly HistorySource[];
}): Promise<ResolvedTakeoverSession> {
  for (const candidate of options.ranked) {
    const messages = await readRecordMessages(
      candidate.record,
      options.historyPaths,
      options.sources,
    );
    const sourceProvider = providerForHistorySource(candidate.source);
    if (messages === null || sourceProvider === null) {
      continue;
    }
    return {
      sourceProvider,
      sourceDisplayName: takeoverDisplayName(sourceProvider),
      historySource: candidate.source,
      historyId: candidate.historyId,
      sourceId: candidate.sourceId,
      title: candidate.title,
      cwd: options.resolvedCwd,
      gitBranch: candidate.gitBranch,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
      rawTranscriptPath: candidate.path,
      messages,
    };
  }
  throw new TakeoverError(
    `Found session metadata in ${options.resolvedCwd}, but none had a readable raw transcript on disk.`,
  );
}

export async function resolveTakeoverSession(
  options: ResolveSessionOptions = {},
): Promise<ResolvedTakeoverSession> {
  const historyPaths = options.historyPaths ?? defaultHistoryPaths();
  const runtimePaths = options.runtimePaths ?? defaultHistoryRuntimePaths();
  if (options.historyId !== undefined) {
    return resolveByHistoryId(
      options.historyId,
      options,
      historyPaths,
      runtimePaths,
    );
  }
  const terminal = options.terminal ?? null;
  const resolvedCwd = trimTrailingSeparators(
    options.cwd ?? terminal?.cwd ?? process.cwd(),
  );
  const pathCache = new Map<string, string>();
  const workspaces = await normalizeWorkspacePaths(resolvedCwd, pathCache);
  const canonicalTarget = await canonicalPath(resolvedCwd, pathCache);

  const effectiveProvider =
    options.fromProvider ?? terminal?.sourceProvider ?? null;
  const targetSource =
    effectiveProvider === null
      ? null
      : historySourceForProvider(effectiveProvider);

  const indexedResult = await queryIndexedWorkspaceCandidates({
    runtimePaths,
    workspaces,
    canonicalTarget,
    targetSource,
    pathCache,
  });
  const indexedByKey = new Map(
    indexedResult.candidates.map((entry) => [
      `${entry.source}:${entry.sourceId}`,
      entry,
    ]),
  );

  const scanned = needsDirectSourceScan(
    indexedResult.opened,
    indexedResult.candidates,
    terminal,
  )
    ? await scanWorkspaceSources({
        historyPaths,
        canonicalTarget,
        fallbackWorkspace: resolvedCwd,
        terminalPromptHash: terminal?.promptHash ?? null,
        targetSource,
        indexedByKey,
        pathCache,
        ...(options.sources === undefined
          ? {}
          : { customSources: options.sources }),
      })
    : [];

  const ranked = await rankWorkspaceCandidates({
    indexed: indexedResult.candidates,
    scanned,
    targetSource,
    antigravityRoots: historyPaths.antigravityRoots,
    terminal,
  });
  if (ranked.length === 0) {
    const providerHint =
      effectiveProvider === null ? "" : ` for ${effectiveProvider}`;
    throw new TakeoverError(
      `No agent session found in workspace ${resolvedCwd}${providerHint}.`,
    );
  }
  return firstReadableSession({
    ranked,
    resolvedCwd,
    historyPaths,
    ...(options.sources === undefined ? {} : { sources: options.sources }),
  });
}
