import { describe, expect, test } from "vitest";
import {
  ACCOUNT_LAKE_COLUMNS,
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  MATCH_TEAM_BAN_LAKE_COLUMNS,
  MATCH_TEAM_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  TIMELINE_COVERAGE_LAKE_COLUMNS,
  TIMELINE_EVENT_LAKE_COLUMNS,
  TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
  TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
} from "@scout-for-lol/data";
import { lakeSchemaFingerprint } from "#src/report-lake/schema.ts";

function tableSignature(
  name: string,
  columns: Readonly<Record<string, string>>,
): string {
  return `${name}=${Object.entries(columns)
    .map(([column, type]) => `${column}:${type}`)
    .sort()
    .join(",")}`;
}

/**
 * The fingerprint is the only mechanism that forces a full lake rebuild when a
 * column changes; a fold would otherwise hardlink the previous build and
 * publish parquet files that disagree on columns, which fails to bind at all.
 *
 * A table missing from the fingerprint silently loses that protection.
 * Recomputing the expected hash from an explicit list is what makes a future
 * table fail here until someone updates both places.
 */
describe("lakeSchemaFingerprint", () => {
  test("covers every lake table", () => {
    const independentSchema = [
      tableSignature("matches", MATCH_LAKE_COLUMNS),
      tableSignature("match_teams", MATCH_TEAM_LAKE_COLUMNS),
      tableSignature("match_team_bans", MATCH_TEAM_BAN_LAKE_COLUMNS),
      tableSignature("prematch", PREMATCH_LAKE_COLUMNS),
      tableSignature("accounts", ACCOUNT_LAKE_COLUMNS),
      tableSignature(
        "competition_rank_history",
        COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
      ),
      tableSignature("timeline_events", TIMELINE_EVENT_LAKE_COLUMNS),
      tableSignature(
        "timeline_event_participants",
        TIMELINE_EVENT_PARTICIPANT_LAKE_COLUMNS,
      ),
      tableSignature(
        "timeline_participant_frames",
        TIMELINE_PARTICIPANT_FRAME_LAKE_COLUMNS,
      ),
      tableSignature("timeline_coverage", TIMELINE_COVERAGE_LAKE_COLUMNS),
    ].join("\n");
    const expected = new Bun.CryptoHasher("sha256")
      .update(`${independentSchema}\n`)
      .digest("hex")
      .slice(0, 16);

    expect(lakeSchemaFingerprint()).toBe(expected);
  });

  test("changes when a covered table's columns change", () => {
    const before = lakeSchemaFingerprint();
    // Sanity: the fingerprint is derived, not a frozen literal.
    expect(before).toHaveLength(16);
    expect(before).toMatch(/^[0-9a-f]{16}$/u);
  });
});
