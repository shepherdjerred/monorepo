import { dialogueFirstExcerpt } from "./context.ts";
import { defaultHistoryPaths } from "./paths.ts";
import { createHistorySources } from "./sources.ts";
import type {
  HistoryMessage,
  HistoryRecord,
  HistoryResult,
  HistoryWarning,
} from "./types.ts";

export async function targetedMessages(
  records: readonly HistoryRecord[],
): Promise<{
  readonly messages: ReadonlyMap<string, readonly HistoryMessage[]>;
  readonly warnings: readonly HistoryWarning[];
}> {
  const sources = new Map(
    createHistorySources().map((source) => [source.name, source]),
  );
  const bySource = Map.groupBy(records, (record) => record.source);
  const messages = new Map<string, readonly HistoryMessage[]>();
  const warnings: HistoryWarning[] = [];
  const paths = defaultHistoryPaths();
  await Promise.all(
    [...bySource.entries()].map(async ([sourceName, sourceRecords]) => {
      const source = sources.get(sourceName);
      if (source === undefined) {
        throw new Error(`No history adapter exists for ${sourceName}`);
      }
      const result = await source.read(paths, sourceRecords);
      if (result.error !== null) {
        warnings.push({ source: sourceName, message: result.error });
        return;
      }
      const missingSourceIds = new Set(result.missingSourceIds);
      for (const record of sourceRecords) {
        if (missingSourceIds.has(record.sourceId)) {
          warnings.push({
            source: sourceName,
            message: `History record ${String(record.id)} is no longer available in ${source.label}; rerun 'toolkit history search'.`,
          });
          continue;
        }
        const recordMessages = result.messages.get(record.sourceId);
        if (recordMessages === undefined) {
          throw new Error(
            `${source.label} did not classify requested record ${String(record.id)}`,
          );
        }
        messages.set(`${record.source}:${record.sourceId}`, recordMessages);
      }
    }),
  );
  return { messages, warnings };
}

export async function addExcerpts(
  records: readonly HistoryResult[],
  query: string,
): Promise<{
  readonly results: readonly HistoryResult[];
  readonly warnings: readonly HistoryWarning[];
}> {
  if (records.length === 0) {
    return { results: records, warnings: [] };
  }
  const targeted = await targetedMessages(records);
  return {
    results: records.map((record) => ({
      ...record,
      excerpt: dialogueFirstExcerpt(
        targeted.messages.get(`${record.source}:${record.sourceId}`) ?? [],
        query,
      ),
    })),
    warnings: targeted.warnings,
  };
}
