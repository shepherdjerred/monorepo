import type {
  HistoryDocument,
  UsageEventEntry,
} from "@shepherdjerred/toolkit/lib/history/types.ts";
import {
  buildCodexThreadDocument,
  usageOnlyCodexDocument,
  type CodexThreadBuild,
} from "./codex.ts";

export type AssembledCodexDocuments = {
  readonly threadDocuments: readonly HistoryDocument[];
  readonly catalogDocuments: readonly HistoryDocument[];
  readonly historyDocuments: readonly HistoryDocument[];
  readonly placeholderDocuments: readonly HistoryDocument[];
};

export function hashCodexDocument(document: HistoryDocument): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(
    JSON.stringify([
      document.sourceId,
      document.title,
      document.path,
      document.workspace,
      document.agent,
      document.createdAt,
      document.updatedAt,
      document.runtimeId,
      document.openingPromptHash,
      document.dialogueText,
      document.toolOutputText,
      document.usageEvents.map((event) => [
        event.occurredAt,
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheCreationTokens,
        event.cachedInputTokens,
        event.reasoningTokens,
        event.costUsd,
        event.costComplete,
      ]),
    ]),
  );
  return hasher.digest("hex");
}

export function catalogOverlaySignature(document: HistoryDocument): string {
  return JSON.stringify([
    document.title,
    document.workspace,
    document.agent,
    document.toolOutputText,
  ]);
}

export function overlayAffectedThreads(
  catalogDocuments: readonly HistoryDocument[],
  previous: ReadonlyMap<string, string>,
): {
  readonly overlay: ReadonlyMap<string, string>;
  readonly affected: ReadonlySet<string>;
} {
  const overlay = new Map<string, string>();
  for (const document of catalogDocuments) {
    if (document.runtimeId !== null) {
      overlay.set(document.runtimeId, catalogOverlaySignature(document));
    }
  }
  const affected = new Set<string>();
  for (const [threadId, signature] of overlay) {
    if (previous.get(threadId) !== signature) {
      affected.add(threadId);
    }
  }
  for (const threadId of previous.keys()) {
    if (!overlay.has(threadId)) {
      affected.add(threadId);
    }
  }
  return { overlay, affected };
}

function overlayCatalog(
  build: CodexThreadBuild,
  usage: readonly UsageEventEntry[],
  catalogByThread: ReadonlyMap<string, HistoryDocument>,
): HistoryDocument {
  const document = buildCodexThreadDocument(
    build.filePath,
    build.item,
    build.messages,
    usage,
  );
  const catalog =
    document.runtimeId === null
      ? undefined
      : catalogByThread.get(document.runtimeId);
  if (catalog === undefined) {
    return document;
  }
  return {
    ...document,
    title: catalog.title,
    workspace: catalog.workspace,
    agent: catalog.agent,
    toolOutputText: [document.toolOutputText, catalog.toolOutputText]
      .filter((text) => text.length > 0)
      .join("\n"),
  } satisfies HistoryDocument;
}

export type ClaimedCodexDocuments = {
  readonly catalogDocuments: readonly HistoryDocument[];
  readonly historyDocuments: readonly HistoryDocument[];
  readonly placeholderDocuments: readonly HistoryDocument[];
};

/**
 * Attaches each thread's usage to exactly one document: a standalone
 * catalog document, otherwise the first `history.jsonl` prompt for that
 * thread, otherwise a usage-only placeholder. Threads with a thread-history
 * document arrive pre-claimed via `indexedThreadIds` — their usage was
 * attached at build time. `queryUsage` sums by document (not by thread),
 * so attaching the same events to more than one document would multiply
 * that session's reported tokens and cost. Claiming is per-thread
 * independent, so an incremental scan that rebuilds only affected threads
 * derives byte-identical documents.
 */
export function claimCodexUsage(input: {
  readonly catalogDocuments: readonly HistoryDocument[];
  readonly historyDocuments: readonly HistoryDocument[];
  readonly usageByThread: ReadonlyMap<string, readonly UsageEventEntry[]>;
  readonly indexedThreadIds: ReadonlySet<string>;
  readonly sessionsDir: string;
}): ClaimedCodexDocuments {
  const usageAttributed = new Set(input.indexedThreadIds);
  const claimUsage = (document: HistoryDocument): HistoryDocument => {
    if (
      document.runtimeId === null ||
      usageAttributed.has(document.runtimeId)
    ) {
      return document;
    }
    const events = input.usageByThread.get(document.runtimeId);
    if (events === undefined) {
      return document;
    }
    usageAttributed.add(document.runtimeId);
    return { ...document, usageEvents: events } satisfies HistoryDocument;
  };
  const catalogDocuments = input.catalogDocuments
    .filter(
      (document) =>
        document.runtimeId === null ||
        !input.indexedThreadIds.has(document.runtimeId),
    )
    .map((document) => claimUsage(document));
  const historyDocuments = input.historyDocuments.map((document) =>
    claimUsage(document),
  );
  // Usage that matched none of the above still needs a place to live —
  // otherwise `history usage` silently omits that session's tokens and cost.
  const placeholderDocuments: HistoryDocument[] = [];
  for (const [threadId, events] of input.usageByThread) {
    if (!usageAttributed.has(threadId)) {
      placeholderDocuments.push(
        usageOnlyCodexDocument(input.sessionsDir, threadId, events),
      );
    }
  }
  return { catalogDocuments, historyDocuments, placeholderDocuments };
}

/**
 * Builds every codex document from already-parsed inputs: thread builds
 * with their catalog overlay, then usage claiming across the catalog,
 * history prompts, and placeholders.
 */
export function assembleCodexDocuments(input: {
  readonly threadBuilds: readonly CodexThreadBuild[];
  readonly indexedThreadIds: ReadonlySet<string>;
  readonly catalogDocuments: readonly HistoryDocument[];
  readonly historyDocuments: readonly HistoryDocument[];
  readonly usageByThread: ReadonlyMap<string, readonly UsageEventEntry[]>;
  readonly sessionsDir: string;
}): AssembledCodexDocuments {
  const catalogByThread = new Map(
    input.catalogDocuments.flatMap((document) =>
      document.runtimeId === null
        ? []
        : [[document.runtimeId, document] as const],
    ),
  );
  const threadDocuments = input.threadBuilds.map((build) =>
    overlayCatalog(
      build,
      input.usageByThread.get(build.item.threadId) ?? [],
      catalogByThread,
    ),
  );
  const claimed = claimCodexUsage(input);
  return { threadDocuments, ...claimed };
}
