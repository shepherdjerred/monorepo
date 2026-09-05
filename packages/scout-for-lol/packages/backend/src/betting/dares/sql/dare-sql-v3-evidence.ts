import { z } from "zod";
import type {
  DareSqlV3Compilation,
  DareSqlV3Evidence,
} from "@scout-for-lol/data";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";

const TimelineEvidenceRowSchema = z.strictObject({
  event_id: z.string(),
  match_id: z.string(),
  target_key: z.string().regex(/^T[1-5]$/u),
  event_timestamp_ms: z.coerce.number().int().nonnegative(),
  frame_index: z.coerce.number().int().nonnegative(),
  event_index: z.coerce.number().int().nonnegative(),
  event_type: z.string(),
  item_id: z.coerce.number().int().nullable(),
  skill_slot: z.coerce.number().int().nullable(),
});

export async function relevantDareTimelineEvents(
  session: DuckDBSession,
  compilation: DareSqlV3Compilation,
): Promise<DareSqlV3Evidence["timelineEvents"]> {
  const targetQueries = compilation.facts.targetKeys.map(
    (targetKey) => `SELECT
      e.event_id,
      e.match_id,
      '${targetKey}' AS target_key,
      e.event_timestamp_ms,
      e.frame_index,
      e.event_index,
      e.event_type,
      e.item_id,
      e.skill_slot
    FROM timeline_events AS e
    JOIN ${targetKey} AS target
      ON target.match_id = e.match_id
      AND target.participant_id = e.participant_id
    WHERE e.event_type IN (
      'ITEM_PURCHASED',
      'ITEM_SOLD',
      'ITEM_UNDO',
      'SKILL_LEVEL_UP'
    )`,
  );
  const rows = await session.run(
    `${targetQueries.join(" UNION ALL ")}
    ORDER BY event_timestamp_ms, frame_index, event_index, event_id, target_key`,
  );
  return rows.map((raw) => {
    const row = TimelineEvidenceRowSchema.parse(raw);
    return {
      eventId: row.event_id,
      matchId: row.match_id,
      targetKey: row.target_key,
      timestampMs: row.event_timestamp_ms,
      frameIndex: row.frame_index,
      eventIndex: row.event_index,
      type: row.event_type,
      itemId: row.item_id,
      skillSlot: row.skill_slot,
    };
  });
}
