import { z } from "zod";
import type { HistoryPaths } from "./paths.ts";

export const HISTORY_SOURCE_NAMES = [
  "conductor",
  "claude",
  "codex",
  "cursor",
  "opencode-conductor",
  "opencode-standalone",
  "antigravity",
  "grok",
] as const;

export const HistorySourceNameSchema = z.enum(HISTORY_SOURCE_NAMES);

export type HistorySourceName = z.infer<typeof HistorySourceNameSchema>;

export function parseHistorySourceName(
  value: string,
  context: string,
): HistorySourceName {
  const parsed = HistorySourceNameSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Unknown history source ${context}: ${value}`);
  }
  return parsed.data;
}

export type HistoryRuntimeRef = {
  readonly source: HistorySourceName;
  readonly runtimeId: string;
};

/**
 * One priced usage event, timestamped to when it actually happened — never
 * a whole-document lifetime total. `queryUsage` filters and aggregates these
 * by `occurredAt`, so a `--since` window only counts activity within it
 * instead of attributing an entire long-lived session's usage to whichever
 * window its last message happens to fall in.
 */
export type UsageEventEntry = {
  readonly occurredAt: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
  readonly costUsd: number | null;
  readonly costComplete: boolean;
};

export type HistoryDocument = {
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly title: string;
  readonly path: string;
  readonly workspace: string | null;
  readonly agent: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly runtimeId: string | null;
  readonly openingPromptHash: string | null;
  readonly dialogueText: string;
  readonly toolOutputText: string;
  readonly usageEvents: readonly UsageEventEntry[];
};

export type HistoryMessageRole = "user" | "assistant" | "tool" | "unknown";

export type HistoryMessage = {
  readonly role: HistoryMessageRole;
  readonly text: string;
  readonly createdAt: string | null;
};

export type HistorySourceResult = {
  readonly source: HistorySourceName;
  readonly available: boolean;
  readonly documents: readonly HistoryDocument[];
  readonly fingerprint: string;
  readonly error: string | null;
};

export type HistorySource = {
  readonly name: HistorySourceName;
  readonly label: string;
  scan: (paths: HistoryPaths) => Promise<HistorySourceResult>;
  read: (
    paths: HistoryPaths,
    records: readonly HistoryRecord[],
  ) => Promise<HistorySourceReadResult>;
};

export type HistoryRecord = {
  readonly id: number;
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly title: string;
  readonly path: string;
  readonly workspace: string | null;
  readonly agent: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly excerpt: string | null;
};

export type IndexedHistoryRecord = HistoryRecord & {
  readonly runtimeId: string | null;
  readonly openingPromptHash: string | null;
};

export type HistoryGroupMember = Omit<HistoryRecord, "excerpt">;

export type HistoryResult = HistoryRecord & {
  readonly members: readonly HistoryGroupMember[];
};

export type HistorySourceReadResult = {
  readonly source: HistorySourceName;
  readonly messages: ReadonlyMap<string, readonly HistoryMessage[]>;
  readonly missingSourceIds: readonly string[];
  readonly error: string | null;
};

export type HistoryWarning = {
  readonly source: HistorySourceName;
  readonly message: string;
};

export type HistorySourceStatus = {
  readonly source: HistorySourceName;
  readonly label: string;
  readonly available: boolean;
  readonly indexedDocuments: number;
  readonly lastScanAt: string | null;
  readonly error: string | null;
};

export type UsageTotals = {
  readonly documentCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
  readonly costUsd: number;
  readonly costComplete: boolean;
};

export type UsageBySource = UsageTotals & {
  readonly source: HistorySourceName;
};

export type UsageReport = {
  readonly total: UsageTotals;
  readonly bySource: readonly UsageBySource[];
};
