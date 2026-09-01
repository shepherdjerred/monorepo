import { unlink } from "node:fs/promises";
import path from "node:path";
import type { S3Client } from "@aws-sdk/client-s3";
import type { DuckDbColumnType } from "@scout-for-lol/data";
import { NdjsonFileWriter } from "#src/report-lake/ndjson-writer.ts";
import { populateTimelinesFromS3 } from "#src/report-lake/rebuild-sources.ts";
import {
  duckDbColumnsSpec,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "#src/report-lake/schema.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";

type TimelineWriter = {
  table: string;
  path: string;
  writer: NdjsonFileWriter;
  columns: Record<string, DuckDbColumnType>;
};

function timelineWriters(buildDir: string): {
  entries: TimelineWriter[];
  events: NdjsonFileWriter;
  eventParticipants: NdjsonFileWriter;
  participantFrames: NdjsonFileWriter;
  coverage: NdjsonFileWriter;
} {
  const specs = [
    { table: "timeline_events", columns: TIMELINE_EVENT_LAKE_COLUMNS },
    {
      table: "timeline_event_participants",
      columns: TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
    },
    {
      table: "timeline_participant_frames",
      columns: TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
    },
    { table: "timeline_coverage", columns: TIMELINE_COVERAGE_LAKE_COLUMNS },
  ];
  const entries = specs.map((spec) => {
    const filePath = path.join(buildDir, `${spec.table}.ndjson.tmp`);
    return {
      ...spec,
      path: filePath,
      writer: new NdjsonFileWriter(filePath),
    };
  });
  const events = entries.at(0)?.writer;
  const eventParticipants = entries.at(1)?.writer;
  const participantFrames = entries.at(2)?.writer;
  const coverage = entries.at(3)?.writer;
  if (
    events === undefined ||
    eventParticipants === undefined ||
    participantFrames === undefined ||
    coverage === undefined
  ) {
    throw new Error("Timeline compaction writer catalog is incomplete.");
  }
  return { entries, events, eventParticipants, participantFrames, coverage };
}

export type TimelineCompactionResult = {
  eventRows: number;
  eventParticipantRows: number;
  participantFrameRows: number;
  coverageRows: number;
  skipped: number;
  foldedIds: Set<string>;
};

/** Rebuild every normalized timeline relation from retained S3 objects. */
export async function rebuildTimelineParquet(options: {
  client: S3Client;
  bucket: string;
  buildDir: string;
  abortSignal: AbortSignal;
  timeoutMs: number;
  onProgress?: (progress: {
    files: number;
    rows: number;
    skipped: number;
  }) => void;
}): Promise<TimelineCompactionResult> {
  const writers = timelineWriters(options.buildDir);
  const foldedIds = new Set<string>();
  const skipped = await populateTimelinesFromS3({
    client: options.client,
    bucket: options.bucket,
    writers,
    foldedIds,
    abortSignal: options.abortSignal,
    ...(options.onProgress === undefined
      ? {}
      : { onProgress: options.onProgress }),
  });
  await Promise.all(writers.entries.map(async (entry) => entry.writer.close()));
  try {
    await withDuckDBConnection(
      async (session) => {
        for (const entry of writers.entries) {
          if (entry.writer.rows === 0) continue;
          await session.run(
            `COPY (SELECT * FROM read_json($1, format='newline_delimited', columns=${duckDbColumnsSpec(entry.columns)})) TO '${path.join(options.buildDir, entry.table)}' (FORMAT PARQUET, PARTITION_BY (month), OVERWRITE_OR_IGNORE)`,
            [entry.path],
          );
        }
      },
      { timeoutMs: options.timeoutMs },
    );
  } finally {
    await Promise.all(writers.entries.map(async (entry) => unlink(entry.path)));
  }
  return {
    eventRows: writers.events.rows,
    eventParticipantRows: writers.eventParticipants.rows,
    participantFrameRows: writers.participantFrames.rows,
    coverageRows: writers.coverage.rows,
    skipped,
    foldedIds,
  };
}
