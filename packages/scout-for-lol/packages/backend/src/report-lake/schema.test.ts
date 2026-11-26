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
import { z } from "zod";
import {
  LAKE_PREDECESSOR_SCHEMA_FINGERPRINT,
  LAKE_SCHEMA_EPOCH,
  LAKE_TABLE_COLUMNS,
  lakeSchemaFingerprint,
  lakeSchemaFingerprintOf,
  lakeSchemaStatus,
} from "#src/report-lake/schema.ts";
import { LANE_RESULT_LAKE_COLUMNS } from "#src/report-lake/lane-results/lane-result-columns.ts";
import { RAW_DOCUMENT_LAKE_COLUMNS } from "@scout-for-lol/data/model/reports/raw-document-lake-columns.ts";

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
      tableSignature("raw_documents", RAW_DOCUMENT_LAKE_COLUMNS),
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
      tableSignature("lane_results", LANE_RESULT_LAKE_COLUMNS),
    ].join("\n");
    const expected = new Bun.CryptoHasher("sha256")
      .update(`${independentSchema}\n`)
      .digest("hex")
      .slice(0, 16);

    expect(lakeSchemaFingerprint()).toBe(expected);
  });

  test("changes when a covered table's columns change", () => {
    const before = lakeSchemaFingerprint();
    expect(before).toHaveLength(16);
    expect(before).toMatch(/^[0-9a-f]{16}$/u);
    const alteredColumnType = lakeSchemaFingerprintOf({
      ...LAKE_TABLE_COLUMNS,
      matches: {
        ...MATCH_LAKE_COLUMNS,
        game_duration_seconds: "BIGINT",
      },
    });
    const addedColumn = lakeSchemaFingerprintOf({
      ...LAKE_TABLE_COLUMNS,
      matches: {
        ...MATCH_LAKE_COLUMNS,
        synthetic_new_column: "VARCHAR",
      },
    });
    expect(alteredColumnType).not.toBe(before);
    expect(addedColumn).not.toBe(before);
  });

  test("moves LAKE_SCHEMA_EPOCH in lockstep with lakeSchemaFingerprint (AI-658)", async () => {
    // Bumping lake columns/types changes `lakeSchemaFingerprint()` and forces
    // an irreversible on-PVC report-lake rebuild. Update `LAKE_SCHEMA_EPOCH`
    // and Scout's forward-only Delivery configuration (`scout.reportLakeSchemaEpoch`)
    // together so monitor rollback holds instead of rolling back across an
    // incompatible Parquet schema.
    expect({
      epoch: LAKE_SCHEMA_EPOCH,
      fingerprint: lakeSchemaFingerprint(),
    }).toEqual({
      epoch: 3,
      fingerprint: "04a28bc7e0b80111",
    });

    const SpecializedSchema = z.object({
      configuration: z.object({
        "scout.reportLakeSchemaEpoch": z.string(),
      }),
    });
    const CatalogConfigSchema = z.object({
      content: z.object({
        "scout.reportLakeSchemaEpoch": z.string(),
      }),
      forwardOnly: z.array(z.string()),
    });
    for (const stage of ["beta", "prod"] as const) {
      const v1File = Bun.file(
        new URL(
          `../../../../../delivery/registrations/specialized/scout-${stage}/environment.json`,
          import.meta.url,
        ),
      );
      if (await v1File.exists()) {
        const parsedV1 = SpecializedSchema.parse(await v1File.json());
        expect(parsedV1.configuration["scout.reportLakeSchemaEpoch"]).toBe(
          String(LAKE_SCHEMA_EPOCH),
        );
      }
      const v2File = Bun.file(
        new URL(
          `../../../../../delivery/registrations/v2/scout-for-lol/${stage}/configuration.json`,
          import.meta.url,
        ),
      );
      if (await v2File.exists()) {
        const parsedV2 = CatalogConfigSchema.parse(await v2File.json());
        expect(parsedV2.content["scout.reportLakeSchemaEpoch"]).toBe(
          String(LAKE_SCHEMA_EPOCH),
        );
        expect(parsedV2.forwardOnly).toContain(
          "/helm/parameters/scout.reportLakeSchemaEpoch",
        );
      }
    }
  });
});

describe("the declared predecessor schema", () => {
  test("is exactly this schema without the lane_results table", () => {
    const { lane_results: _added, ...predecessor } = LAKE_TABLE_COLUMNS;

    expect(lakeSchemaFingerprintOf(predecessor)).toBe(
      LAKE_PREDECESSOR_SCHEMA_FINGERPRINT,
    );
    expect(LAKE_PREDECESSOR_SCHEMA_FINGERPRINT).not.toBe(
      lakeSchemaFingerprint(),
    );
  });

  test("is the only other fingerprint a published build may carry", () => {
    expect(lakeSchemaStatus(lakeSchemaFingerprint())).toBe("current");
    expect(lakeSchemaStatus(LAKE_PREDECESSOR_SCHEMA_FINGERPRINT)).toBe(
      "predecessor",
    );
    // e086a72a1a8176aa is the retired participant-kind predecessor.
    for (const other of [
      "e086a72a1a8176aa",
      "c0d6dcb0944686f1",
      "1a45b23ce7f086cb",
      undefined,
    ]) {
      expect(lakeSchemaStatus(other)).toBe("unknown");
    }
  });
});
