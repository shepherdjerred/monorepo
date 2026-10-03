import { describe, expect, test } from "vitest";
import { MATCH_READ_COLUMNS } from "@scout-for-lol/data";
import { dareSqlCatalog } from "#src/betting/dares/sql/dare-sql-catalog.ts";

describe("Dare SQL catalog", () => {
  test("advertises exactly the participant columns its lake source projects", () => {
    const catalog = dareSqlCatalog();
    const expected = Object.keys(MATCH_READ_COLUMNS);
    for (const relation of catalog.relations.filter(
      (entry) =>
        entry.name === "match_participants" || /^T[1-5]$/.test(entry.name),
    )) {
      expect(relation.columns.map((column) => column.name)).toEqual(expected);
    }
  });
});
