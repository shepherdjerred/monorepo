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

export type HistoryDocument = {
  readonly source: HistorySourceName;
  readonly sourceId: string;
  readonly title: string;
  readonly path: string;
  readonly workspace: string | null;
  readonly agent: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly searchText: string;
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

export type HistorySourceStatus = {
  readonly source: HistorySourceName;
  readonly label: string;
  readonly available: boolean;
  readonly indexedDocuments: number;
  readonly lastScanAt: string | null;
  readonly error: string | null;
};
