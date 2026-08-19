import type { HistoryPaths } from "./paths.ts";

export const HISTORY_SOURCE_NAMES = [
  "conductor",
  "claude",
  "codex",
  "cursor",
  "opencode-conductor",
  "opencode-standalone",
] as const;

export type HistorySourceName = (typeof HISTORY_SOURCE_NAMES)[number];

export type HistoryRuntimeRef = {
  readonly source: HistorySourceName;
  readonly runtimeId: string;
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
