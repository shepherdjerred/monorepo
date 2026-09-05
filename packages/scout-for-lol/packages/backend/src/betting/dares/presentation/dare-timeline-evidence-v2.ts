import type { DareCompiledPlanV2, RawTimeline } from "@scout-for-lol/data";
import { z } from "zod";
import { resolveLakeDir } from "#src/report-lake/paths.ts";
import type { DareTimelineEvidenceV2 } from "#src/betting/dares/evaluation/dare-evaluator-v2.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import { bindParams } from "#src/reports/duckdb/lake-reads.ts";
import {
  buildTimelineCoverageSource,
  buildTimelineEventParticipantsSource,
  buildTimelineEventsSource,
  resolveLakeFiles,
  scalarParam,
  type LakeFiles,
  type SqlFragment,
} from "#src/reports/duckdb/lake.ts";
import { dareValueNeedsTimeline } from "#src/betting/dares/evaluation/dare-value-v2.ts";
import { flattenTimeline } from "#src/report-lake/flatten-timeline.ts";

const TimelineEventEvidenceRowSchema = z.object({
  event_id: z.string(),
  event_type: z.string(),
  event_timestamp_ms: z.union([z.bigint(), z.number()]).transform(Number),
  item_id: z.number().nullable(),
  monster_type: z.string().nullable(),
  building_type: z.string().nullable(),
});

const TimelineParticipantEvidenceRowSchema = z.object({
  event_id: z.string(),
  puuid: z.string().nullable(),
  role: z.enum(["subject", "killer", "victim", "assist", "creator"]),
});

const TimelineCoverageEvidenceRowSchema = z.object({
  coverage_state: z.literal("complete"),
});

function needsTimelinePredicate(
  expression: DareCompiledPlanV2["gameSets"][number]["predicate"],
): boolean {
  if (expression.kind === "comparison") {
    return dareValueNeedsTimeline(expression.value);
  }
  if (expression.kind === "not")
    return needsTimelinePredicate(expression.operand);
  return expression.operands.some((operand) => needsTimelinePredicate(operand));
}

export function darePlanNeedsTimeline(plan: DareCompiledPlanV2): boolean {
  return plan.gameSets.some(
    (gameSet) =>
      needsTimelinePredicate(gameSet.predicate) ||
      gameSet.projections.some((projection) =>
        dareValueNeedsTimeline(projection.value),
      ),
  );
}

/** Evaluate a just-retained timeline without waiting for DuckDB file discovery. */
export function dareTimelineEvidenceFromRawV2(
  timeline: RawTimeline,
): DareTimelineEvidenceV2 {
  const flattened = flattenTimeline(timeline, new Date(0));
  return {
    coverage: "complete",
    events: flattened.events.map((event) => ({
      eventId: event.event_id,
      eventType: event.event_type,
      timestampMs: event.event_timestamp_ms,
      itemId: event.item_id,
      monsterType: event.monster_type,
      buildingType: event.building_type,
    })),
    participants: flattened.eventParticipants.map((participant) => ({
      eventId: participant.event_id,
      puuid: participant.puuid,
      role: participant.role,
    })),
  };
}

function matchSource(
  files: LakeFiles,
  matchId: string,
  build: (files: LakeFiles, predicate: SqlFragment) => SqlFragment | undefined,
): SqlFragment | undefined {
  return build(files, {
    sql: "match_id = ?",
    params: [scalarParam(matchId)],
  });
}

export async function loadDareTimelineEvidenceV2(
  matchId: string,
  lakeDir: string = resolveLakeDir(),
): Promise<DareTimelineEvidenceV2> {
  const files = await resolveLakeFiles(lakeDir);
  const coverage = matchSource(files, matchId, buildTimelineCoverageSource);
  if (coverage === undefined)
    return { coverage: "missing", events: [], participants: [] };
  const events = matchSource(files, matchId, buildTimelineEventsSource);
  const participants = matchSource(
    files,
    matchId,
    buildTimelineEventParticipantsSource,
  );
  return await withDuckDBConnection(async (session) => {
    const coverageRows = TimelineCoverageEvidenceRowSchema.array().parse(
      await session.run(
        `SELECT coverage_state FROM (${coverage.sql})`,
        bindParams(session, coverage.params),
      ),
    );
    if (coverageRows.length === 0) {
      return { coverage: "missing", events: [], participants: [] };
    }
    const eventRows =
      events === undefined
        ? []
        : TimelineEventEvidenceRowSchema.array().parse(
            await session.run(
              `SELECT event_id, event_type, event_timestamp_ms, item_id, monster_type, building_type FROM (${events.sql}) ORDER BY frame_index ASC, event_index ASC`,
              bindParams(session, events.params),
            ),
          );
    const participantRows =
      participants === undefined
        ? []
        : TimelineParticipantEvidenceRowSchema.array().parse(
            await session.run(
              `SELECT event_id, puuid, role FROM (${participants.sql}) ORDER BY event_id ASC, role ASC, role_index ASC`,
              bindParams(session, participants.params),
            ),
          );
    return {
      coverage: "complete",
      events: eventRows.map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        timestampMs: row.event_timestamp_ms,
        itemId: row.item_id,
        monsterType: row.monster_type,
        buildingType: row.building_type,
      })),
      participants: participantRows.map((row) => ({
        eventId: row.event_id,
        puuid: row.puuid,
        role: row.role,
      })),
    };
  });
}
