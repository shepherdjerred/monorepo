import type { HistoryPaths } from "./paths.ts";
import type { HistorySource, HistorySourceResult } from "./types.ts";

const SOURCE_SCAN_CONCURRENCY = 2;

export async function scanHistorySources(
  sources: readonly HistorySource[],
  paths: HistoryPaths,
  force = false,
): Promise<HistorySourceResult[]> {
  const results: HistorySourceResult[] = [];
  for (
    let offset = 0;
    offset < sources.length;
    offset += SOURCE_SCAN_CONCURRENCY
  ) {
    results.push(
      ...(await Promise.all(
        sources
          .slice(offset, offset + SOURCE_SCAN_CONCURRENCY)
          .map((source) => source.scan(paths, { force })),
      )),
    );
  }
  return results;
}
