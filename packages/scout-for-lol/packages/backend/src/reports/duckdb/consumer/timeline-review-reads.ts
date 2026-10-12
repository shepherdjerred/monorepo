import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import { runSource } from "./profile-lake-reads.ts";
import {
  buildTimelineEventParticipantsSource,
  buildTimelineParticipantFramesSource,
  scalarParam,
  withLakeQueryRetry,
} from "#src/reports/duckdb/lake.ts";
const LakeIntSchema = z.union([z.bigint(), z.number()]).transform(Number);

const TimelineReviewFrameSchema = z.object({
  frame_timestamp_ms: LakeIntSchema,
  participant_id: LakeIntSchema,
  total_gold: LakeIntSchema,
  xp: LakeIntSchema,
  position_x: LakeIntSchema,
  position_y: LakeIntSchema,
  minions_killed: LakeIntSchema,
  jungle_minions_killed: LakeIntSchema,
  level: LakeIntSchema,
});

export async function fetchTimelineReviewParticipants(options: {
  matchId: RiotMatchId;
  lakeDir?: string;
}) {
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const source = buildTimelineEventParticipantsSource(files, {
        sql: "match_id = ?",
        params: [scalarParam(options.matchId)],
      });
      if (source === undefined) return [];
      return await runSource({
        source,
        sql: `SELECT event_id, participant_id FROM (${source.sql}) ORDER BY event_id, participant_id`,
        schema: z.object({
          event_id: z.string(),
          participant_id: LakeIntSchema,
        }),
      });
    },
  );
}

/** Only the snapshot fields used by interactive match review. */
export async function fetchTimelineReviewFrames(options: {
  matchId: RiotMatchId;
  lakeDir?: string;
}) {
  return await withLakeQueryRetry(
    options.lakeDir ?? resolveLakeDir(),
    async (files) => {
      const source = buildTimelineParticipantFramesSource(files, {
        sql: "match_id = ?",
        params: [scalarParam(options.matchId)],
      });
      if (source === undefined) return [];
      return await runSource({
        source,
        sql: `SELECT ${Object.keys(TimelineReviewFrameSchema.shape).join(", ")} FROM (${source.sql}) ORDER BY frame_timestamp_ms, participant_id`,
        schema: TimelineReviewFrameSchema,
      });
    },
  );
}
