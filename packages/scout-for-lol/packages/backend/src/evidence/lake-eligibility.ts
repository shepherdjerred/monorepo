import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import type { DuckDBSession } from "#src/reports/duckdb/instance.ts";
import {
  effectEligibleMatchIds,
  effectTimelineMatchIds,
  evidenceRecoveryEnabled,
} from "./admission.ts";

/** Apply admission before game caps/order/SQL aggregation, not after evaluation. */
export async function restrictEffectMatchRelation(
  session: DuckDBSession,
  table: "_dare_match_window" | "matches_for_progression",
): Promise<void> {
  if (!evidenceRecoveryEnabled()) return;
  const rows = await session.run(`SELECT DISTINCT match_id FROM ${table}`);
  const ids = rows.map(
    (row) => z.object({ match_id: RiotMatchIdSchema }).parse(row).match_id,
  );
  const eligible = [];
  for (let offset = 0; offset < ids.length; offset += 500)
    eligible.push(
      ...(await effectEligibleMatchIds(ids.slice(offset, offset + 500))),
    );
  if (eligible.length === 0) {
    await session.run(`DELETE FROM ${table}`);
    return;
  }
  await session.run(
    `DELETE FROM ${table} WHERE match_id NOT IN (SELECT unnest(?))`,
    [session.list(eligible)],
  );
}

export async function restrictEffectTimelineRelation(
  session: DuckDBSession,
  table:
    | "timeline_coverage"
    | "timeline_events"
    | "timeline_event_participants"
    | "timeline_participant_frames"
    | "progression_timeline_coverage",
): Promise<void> {
  if (!evidenceRecoveryEnabled()) return;
  const rows = await session.run(`SELECT DISTINCT match_id FROM ${table}`);
  const ids = rows.map(
    (row) => z.object({ match_id: RiotMatchIdSchema }).parse(row).match_id,
  );
  const eligible = [];
  for (let offset = 0; offset < ids.length; offset += 500)
    eligible.push(
      ...(await effectTimelineMatchIds(ids.slice(offset, offset + 500))),
    );
  if (eligible.length === 0) await session.run(`DELETE FROM ${table}`);
  else
    await session.run(
      `DELETE FROM ${table} WHERE match_id NOT IN (SELECT unnest(?))`,
      [session.list(eligible)],
    );
}
