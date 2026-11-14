import { capturedSeriesMask } from "#shared/handoff/captured-monitoring.ts";
import type {
  LibraryEntry,
  LibraryReview,
} from "#client/library-import/selection.ts";

/** Historical captures without season rows keep their literal approval shape. */
export function capturedMonitoringForSeries(
  review: LibraryReview,
  entry: LibraryEntry,
) {
  const root = entry.sourceRecord;
  if (root.kind !== "media" || root.mediaKind !== "series")
    throw new Error("Monitoring needs an exact captured series");
  const records = review.report.entries
    .filter((row) => row.captureHash === entry.captureHash)
    .map((row) => row.sourceRecord);
  return records.some(
    (record) =>
      record.kind === "media" &&
      record.mediaKind === "season" &&
      record.parentSourceId === root.sourceId,
  )
    ? { monitoringMask: capturedSeriesMask(records, root.sourceId) }
    : {};
}
