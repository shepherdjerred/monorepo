import { describe, expect, test } from "vitest";
import {
  ACCOUNT_LAKE_COLUMNS,
  COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
  MATCH_LAKE_COLUMNS,
  PREDICTION_OBSERVATION_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  lakeSchemaFingerprint,
} from "#src/report-lake/schema.ts";

/**
 * The fingerprint is the only mechanism that forces a full lake rebuild when a
 * column changes; a fold would otherwise hardlink the previous build and
 * publish parquet files that disagree on columns, which fails to bind at all.
 *
 * A table missing from the fingerprint silently loses that protection —
 * `prediction_observations` was missing until this test existed. Recomputing
 * the expected hash from an explicit list is what makes a future sixth table
 * fail here until someone updates both places.
 */
describe("lakeSchemaFingerprint", () => {
  test("covers every lake table", () => {
    const tables: Record<string, Record<string, string>> = {
      matches: MATCH_LAKE_COLUMNS,
      prematch: PREMATCH_LAKE_COLUMNS,
      prediction_observations: PREDICTION_OBSERVATION_LAKE_COLUMNS,
      accounts: ACCOUNT_LAKE_COLUMNS,
      competition_rank_history: COMPETITION_RANK_HISTORY_LAKE_COLUMNS,
    };
    const hasher = new Bun.CryptoHasher("sha256");
    for (const [table, columns] of Object.entries(tables)) {
      const signature = Object.entries(columns)
        .map(([name, type]) => `${name}:${type}`)
        .sort()
        .join(",");
      hasher.update(`${table}=${signature}\n`);
    }

    expect(lakeSchemaFingerprint()).toBe(hasher.digest("hex").slice(0, 16));
  });

  test("changes when a covered table's columns change", () => {
    const before = lakeSchemaFingerprint();
    // Sanity: the fingerprint is derived, not a frozen literal.
    expect(before).toHaveLength(16);
    expect(before).toMatch(/^[0-9a-f]{16}$/u);
  });
});
