import type {
  HistoryGroupMember,
  HistoryRecord,
  HistoryResult,
  HistoryRuntimeRef,
  HistorySourceName,
  HistorySourceStatus,
  HistoryWarning,
  IndexedHistoryRecord,
} from "./types.ts";

const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const RESULT_PAGE_SIZE = 128;

type ResultOptions = {
  readonly includeCurrent: boolean;
  readonly includeDuplicates: boolean;
  readonly currentRuntimes: readonly HistoryRuntimeRef[];
  readonly limit: number;
};

export function publicRecord(record: IndexedHistoryRecord): HistoryRecord {
  return {
    id: record.id,
    source: record.source,
    sourceId: record.sourceId,
    title: record.title,
    path: record.path,
    workspace: record.workspace,
    agent: record.agent,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    excerpt: record.excerpt,
  };
}

function groupMember(record: IndexedHistoryRecord): HistoryGroupMember {
  const visible = publicRecord(record);
  return {
    id: visible.id,
    source: visible.source,
    sourceId: visible.sourceId,
    title: visible.title,
    path: visible.path,
    workspace: visible.workspace,
    agent: visible.agent,
    createdAt: visible.createdAt,
    updatedAt: visible.updatedAt,
  };
}

function singleton(record: IndexedHistoryRecord): HistoryResult {
  return { ...publicRecord(record), members: [groupMember(record)] };
}

function isVisible(
  record: IndexedHistoryRecord,
  options: ResultOptions,
): boolean {
  return (
    options.includeCurrent ||
    record.runtimeId === null ||
    !options.currentRuntimes.some(
      (runtime) =>
        runtime.source === record.source &&
        runtime.runtimeId === record.runtimeId,
    )
  );
}

function promptClusters(
  rankedRecords: readonly IndexedHistoryRecord[],
): IndexedHistoryRecord[][] {
  const rank = new Map(
    rankedRecords.map((record, index) => [record.id, index]),
  );
  const chronological = [...rankedRecords].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const clusters: IndexedHistoryRecord[][] = [];
  let cluster: IndexedHistoryRecord[] = [];
  let anchor = 0;
  for (const record of chronological) {
    const createdAt = Date.parse(record.createdAt);
    if (cluster.length === 0 || createdAt - anchor <= DUPLICATE_WINDOW_MS) {
      if (cluster.length === 0) {
        anchor = createdAt;
      }
      cluster.push(record);
    } else {
      clusters.push(cluster);
      cluster = [record];
      anchor = createdAt;
    }
  }
  if (cluster.length > 0) {
    clusters.push(cluster);
  }
  return clusters.map((members) =>
    members.sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    ),
  );
}

function resultForCluster(
  rankedCluster: readonly IndexedHistoryRecord[],
): HistoryResult {
  const representative = rankedCluster[0];
  if (representative === undefined) {
    throw new Error("History duplicate cluster was empty");
  }
  return {
    ...publicRecord(representative),
    members: rankedCluster.map((record) => groupMember(record)),
  };
}

export function prepareResults(
  rankedRecords: readonly IndexedHistoryRecord[],
  options: ResultOptions,
): HistoryResult[] {
  const records = rankedRecords.filter((record) => isVisible(record, options));
  if (options.includeDuplicates) {
    return records.slice(0, options.limit).map((record) => singleton(record));
  }

  const rank = new Map(records.map((record, index) => [record.id, index]));
  const byPrompt = Map.groupBy(
    records.filter((record) => record.openingPromptHash !== null),
    (record) => record.openingPromptHash ?? "",
  );
  const groupedIds = new Set<number>();
  const clusters: IndexedHistoryRecord[][] = [];
  for (const promptRecords of byPrompt.values()) {
    for (const record of promptRecords) {
      groupedIds.add(record.id);
    }
    clusters.push(...promptClusters(promptRecords));
  }
  for (const record of records) {
    if (!groupedIds.has(record.id)) {
      clusters.push([record]);
    }
  }

  const representativeRank = (cluster: readonly IndexedHistoryRecord[]) =>
    Math.min(
      ...cluster.map(
        (record) => rank.get(record.id) ?? Number.MAX_SAFE_INTEGER,
      ),
    );
  return clusters
    .sort((left, right) => representativeRank(left) - representativeRank(right))
    .slice(0, options.limit)
    .map((cluster) => resultForCluster(cluster));
}

export function collectHistoryResults(
  readPage: (offset: number, limit: number) => readonly IndexedHistoryRecord[],
  readPromptMatches: (
    openingPromptHash: string,
  ) => readonly IndexedHistoryRecord[],
  options: ResultOptions,
): HistoryResult[] {
  const results: HistoryResult[] = [];
  const consumedIds = new Set<number>();
  const cachedClusters = new Map<string, IndexedHistoryRecord[][]>();
  let offset = 0;

  while (results.length < options.limit) {
    const page = readPage(offset, RESULT_PAGE_SIZE);
    offset += page.length;
    for (const record of page) {
      if (!isVisible(record, options) || consumedIds.has(record.id)) {
        continue;
      }
      if (options.includeDuplicates || record.openingPromptHash === null) {
        consumedIds.add(record.id);
        results.push(singleton(record));
      } else {
        const hash = record.openingPromptHash;
        let clusters = cachedClusters.get(hash);
        if (clusters === undefined) {
          clusters = promptClusters(
            readPromptMatches(hash).filter((member) =>
              isVisible(member, options),
            ),
          );
          cachedClusters.set(hash, clusters);
        }
        const cluster = clusters.find((members) =>
          members.some((member) => member.id === record.id),
        );
        if (cluster === undefined) {
          throw new Error(
            `History prompt cluster did not contain indexed record ${String(record.id)}`,
          );
        }
        for (const member of cluster) {
          consumedIds.add(member.id);
        }
        results.push(
          resultForCluster([
            record,
            ...cluster.filter((member) => member.id !== record.id),
          ]),
        );
      }
      if (results.length === options.limit) {
        break;
      }
    }
    if (page.length < RESULT_PAGE_SIZE) {
      break;
    }
  }
  return results;
}

export function sourceWarnings(
  statuses: readonly HistorySourceStatus[],
  requestedSource: HistorySourceName | null,
): HistoryWarning[] {
  const warnings = statuses.flatMap((status) => {
    if (status.error !== null) {
      return [{ source: status.source, message: status.error }];
    }
    if (requestedSource === status.source && !status.available) {
      return [
        {
          source: status.source,
          message: `${status.label} is not installed or its history store is unavailable.`,
        },
      ];
    }
    return [];
  });
  if (
    requestedSource !== null &&
    !statuses.some((status) => status.source === requestedSource)
  ) {
    warnings.push({
      source: requestedSource,
      message: `${requestedSource} has not been scanned by the history daemon.`,
    });
  }
  return warnings;
}
