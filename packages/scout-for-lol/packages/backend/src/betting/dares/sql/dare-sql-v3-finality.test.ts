import { describe, expect, test } from "vitest";
import { compileDareSqlV3 } from "#src/betting/dares/sql/dare-sql-v3.ts";

describe("Dare SQL v3 finality", () => {
  test("only proves structurally monotone count comparisons", async () => {
    await expect(
      compileDareSqlV3({
        queryText: "SELECT COUNT(*) >= 1 AS achieved FROM T1",
        targetKeys: ["T1"],
      }),
    ).resolves.toMatchObject({ finality: "monotone_true" });
    await expect(
      compileDareSqlV3({
        queryText:
          "SELECT AVG(kills * 1.0 / NULLIF(deaths, 0)) >= 1 AS achieved FROM T1",
        targetKeys: ["T1"],
      }),
    ).resolves.toMatchObject({ finality: "deadline_only" });
    await expect(
      compileDareSqlV3({
        queryText: "SELECT COUNT(*) <= 3 AS achieved FROM T1",
        targetKeys: ["T1"],
      }),
    ).resolves.toMatchObject({ finality: "deadline_only" });
    await expect(
      compileDareSqlV3({
        queryText:
          "WITH total AS (SELECT COUNT(*) AS n FROM T1) SELECT COUNT(*) >= 1 AS achieved FROM total WHERE n = 1",
        targetKeys: ["T1"],
      }),
    ).resolves.toMatchObject({ finality: "deadline_only" });
  });
});
