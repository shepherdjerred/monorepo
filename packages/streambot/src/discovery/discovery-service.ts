import type {
  DiscoveryResult,
  DiscoveryScope,
  MediaCandidate,
} from "@shepherdjerred/streambot/discovery/candidate.ts";
import { ConversationContextStore } from "@shepherdjerred/streambot/discovery/conversation-context.ts";
import {
  expandMediaQueries,
  historyReferenceQuery,
  isHistoryReference,
  type MediaIntent,
} from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import {
  scoreLibraryTitle,
  searchLibrary,
  type LibraryEntry,
} from "@shepherdjerred/streambot/sources/library.ts";
import { sourceIdentity } from "@shepherdjerred/streambot/sources/source.ts";
import type { YtdlpSearchResult } from "@shepherdjerred/streambot/sources/ytdlp.ts";

export type DiscoveryServiceDeps = {
  readonly library: () => readonly LibraryEntry[];
  readonly history?: MediaHistoryStore;
  readonly searchYoutube: (
    query: string,
    signal: AbortSignal,
    limit: number,
  ) => Promise<readonly YtdlpSearchResult[]>;
  readonly historyEnabled?: (scope: DiscoveryScope) => Promise<boolean>;
  readonly context?: ConversationContextStore;
};

function candidateToken(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12);
}

function localCandidates(
  entries: readonly LibraryEntry[],
  query: string,
): MediaCandidate[] {
  return searchLibrary(entries, query, 5).map((entry) => ({
    token: candidateToken(),
    provider: "local",
    title: entry.title,
    source: { kind: "file", path: entry.path, title: entry.title },
    score: scoreLibraryTitle(entry.title, query) + 10,
    reason: entry.relativePath,
  }));
}

function youtubeCandidate(
  result: YtdlpSearchResult,
  query: string,
  index: number,
): MediaCandidate {
  return {
    token: candidateToken(),
    provider: "youtube",
    title: result.title,
    source: { kind: "url", url: result.url },
    score: 65 + scoreLibraryTitle(result.title, query) / 3 - index,
    ...(result.channel === undefined ? {} : { channel: result.channel }),
    canonicalUrl: result.url,
    ...(result.thumbnailUrl === undefined
      ? {}
      : { thumbnailUrl: result.thumbnailUrl }),
    ...(result.durationSeconds === undefined
      ? {}
      : { durationSeconds: result.durationSeconds }),
    reason:
      result.channel === undefined ? "YouTube" : `YouTube · ${result.channel}`,
  };
}

function referencedHistoryCandidate(
  history: MediaHistoryStore | undefined,
  scope: DiscoveryScope,
  query: string,
): MediaCandidate | null {
  if (history === undefined) return null;
  const subject = historyReferenceQuery(query);
  return subject === ""
    ? history.previous(scope)
    : (history.search(scope, subject, 1)[0] ?? null);
}

function candidateMatchesSource(
  candidate: MediaCandidate,
  source: MediaIntent["source"],
): boolean {
  return source === "auto" || candidate.provider === source;
}

function contextualCandidate(
  context: ConversationContextStore,
  scope: DiscoveryScope,
  intent: MediaIntent,
  historyEnabled: boolean,
): MediaCandidate | null {
  const candidate = context.select(scope, intent.query);
  return candidate !== null &&
    candidateMatchesSource(candidate, intent.source) &&
    (historyEnabled || candidate.provider !== "history")
    ? candidate
    : null;
}

/** Federates history, local files, and YouTube into one ranked, scoped candidate set. */
export class DiscoveryService {
  private readonly context: ConversationContextStore;

  constructor(private readonly deps: DiscoveryServiceDeps) {
    this.context = deps.context ?? new ConversationContextStore();
  }

  rememberCandidates(
    scope: DiscoveryScope,
    candidates: readonly MediaCandidate[],
  ): void {
    this.context.rememberCandidates(scope, candidates);
  }

  async search(
    intent: MediaIntent,
    scope: DiscoveryScope,
    signal: AbortSignal,
  ): Promise<MediaCandidate[]> {
    signal.throwIfAborted();
    const historyEnabled = await this.isHistoryEnabled(scope);
    const contextual = contextualCandidate(
      this.context,
      scope,
      intent,
      historyEnabled,
    );
    if (contextual !== null) {
      return [contextual];
    }

    if (historyEnabled && isHistoryReference(intent.query)) {
      const previous = referencedHistoryCandidate(
        this.deps.history,
        scope,
        intent.query,
      );
      if (previous !== null) return [previous];
    }

    const queries = expandMediaQueries(intent);
    const includeHistory =
      historyEnabled &&
      (intent.source === "auto" || intent.source === "history");
    const includeLocal = intent.source === "auto" || intent.source === "local";
    const includeYoutube =
      intent.source === "auto" || intent.source === "youtube";
    const history = includeHistory
      ? (this.deps.history?.search(scope, intent.work ?? intent.query, 5) ?? [])
      : [];
    const local = includeLocal
      ? queries.flatMap((query) => localCandidates(this.deps.library(), query))
      : [];
    const youtubeResults = includeYoutube
      ? await Promise.all(
          queries.map((query) => this.deps.searchYoutube(query, signal, 5)),
        )
      : [];
    const youtube = youtubeResults.flatMap((results, queryIndex) =>
      results.map((result, index) =>
        youtubeCandidate(result, queries[queryIndex] ?? intent.query, index),
      ),
    );
    signal.throwIfAborted();

    const unique = new Map<string, MediaCandidate>();
    for (const candidate of [...history, ...local, ...youtube]) {
      const key = sourceIdentity(candidate.source);
      const existing = unique.get(key);
      if (existing === undefined || existing.score < candidate.score) {
        unique.set(key, candidate);
      }
    }
    return [...unique.values()]
      .toSorted(
        (left, right) =>
          right.score - left.score || left.title.localeCompare(right.title),
      )
      .slice(0, 5);
  }

  private async isHistoryEnabled(scope: DiscoveryScope): Promise<boolean> {
    if (this.deps.history === undefined) return false;
    return this.deps.historyEnabled === undefined
      ? true
      : await this.deps.historyEnabled(scope);
  }

  async resolve(
    intent: MediaIntent,
    scope: DiscoveryScope,
    signal: AbortSignal,
  ): Promise<DiscoveryResult> {
    const candidates = await this.search(intent, scope, signal);
    const first = candidates[0];
    if (first === undefined) return { kind: "not-found" };
    const second = candidates[1];
    const confident =
      intent.selection === "anything" ||
      second === undefined ||
      first.provider === "history" ||
      first.score >= 94 ||
      first.score - second.score >= 7;
    if (!confident) {
      this.context.rememberCandidates(scope, candidates);
      return { kind: "ambiguous", candidates };
    }
    this.context.rememberResult(scope, first);
    return { kind: "found", candidate: first };
  }
}
