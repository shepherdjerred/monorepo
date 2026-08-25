import { describe, expect, test } from "vitest";
import {
  MATCH_LAKE_COLUMNS,
  PREMATCH_LAKE_COLUMNS,
  type DuckDbColumnType,
} from "#src/model/lake-columns.ts";
import {
  scoutQlSourceCatalog,
  scoutQlSourceCatalogs,
  type ScoutQlColumnType,
} from "#src/model/scoutql/catalog-columns.ts";

// ── Catalog drift ────────────────────────────────────────────────────────────
// The catalogs are the language's whole vocabulary, and the engine resolves the
// same names against the lake schema. A physical column that exists in one and
// not the other is a query that passes analysis and then fails to bind, so the
// two are pinned against each other here.

const LAKE_TYPE: Record<DuckDbColumnType, ScoutQlColumnType> = {
  VARCHAR: "varchar",
  INTEGER: "integer",
  BIGINT: "bigint",
  DOUBLE: "double",
  BOOLEAN: "boolean",
  TIMESTAMP: "timestamp",
};

const LAKE_MAPS: Record<string, Record<string, DuckDbColumnType>> = {
  match_participants: MATCH_LAKE_COLUMNS,
  competition_match_participants: MATCH_LAKE_COLUMNS,
  player_groups: MATCH_LAKE_COLUMNS,
  prematch_participants: PREMATCH_LAKE_COLUMNS,
};

describe("physical catalog columns come from the lake schema", () => {
  for (const catalog of scoutQlSourceCatalogs()) {
    const lake = LAKE_MAPS[catalog.id];
    if (lake === undefined) {
      continue;
    }
    test(`${catalog.id}: every physical column exists in the lake map with the same type`, () => {
      for (const column of catalog.columns.values()) {
        if (column.virtual) {
          continue;
        }
        const lakeType = lake[column.name];
        expect(lakeType, `${catalog.id}.${column.name}`).toBeDefined();
        if (lakeType !== undefined) {
          expect(column.type, `${catalog.id}.${column.name}`).toBe(
            LAKE_TYPE[lakeType],
          );
        }
      }
    });
  }

  test("the time column of each history source is a real timestamp column", () => {
    for (const catalog of scoutQlSourceCatalogs()) {
      if (catalog.timeColumn === null) {
        continue;
      }
      const column = catalog.columns.get(catalog.timeColumn);
      expect(column?.type, catalog.id).toBe("timestamp");
    }
  });

  test("internal plumbing columns are not exposed", () => {
    for (const catalog of scoutQlSourceCatalogs()) {
      expect(catalog.columns.has("month"), catalog.id).toBe(false);
      expect(catalog.columns.has("dedupe_key"), catalog.id).toBe(false);
    }
  });
});

describe("virtual dimensions match what the engine can compute", () => {
  // These mirror MATCH_VIRTUAL_COLUMNS / PREMATCH_VIRTUAL_COLUMNS and the
  // grouping arms in the backend's expr-sql.ts / group-sql.ts. Exposing a
  // dimension the engine has no arm for is a compile-time failure at run time.
  test("match sources expose exactly the match dimensions", () => {
    const catalog = scoutQlSourceCatalog("match_participants");
    const virtuals = [...(catalog?.columns.values() ?? [])]
      .filter((column) => column.virtual)
      .map((column) => column.name);
    expect(virtuals).toEqual([
      "player",
      "champion",
      "patch",
      "outcome",
      "surrender_state",
      "arena_placement",
      "map",
    ]);
  });

  test("prematch exposes only the dimensions its rows can support", () => {
    const catalog = scoutQlSourceCatalog("prematch_participants");
    const virtuals = [...(catalog?.columns.values() ?? [])]
      .filter((column) => column.virtual)
      .map((column) => column.name);
    expect(virtuals).toEqual(["player", "champion", "map"]);
  });
});

describe("source rules", () => {
  test("rank sources are the snapshot sources and carry three columns", () => {
    for (const id of ["rank_current", "competition_rank"]) {
      const catalog = scoutQlSourceCatalog(id);
      expect(catalog?.timeColumn, id).toBeNull();
      const names = [...(catalog?.columns.keys() ?? [])].filter(
        (name) => name !== "competition_id",
      );
      expect(names, id).toEqual(["player", "score", "rank"]);
    }
  });

  test("only the competition sources require a competition id", () => {
    const requiring = scoutQlSourceCatalogs()
      .filter((catalog) => catalog.requiresCompetitionId)
      .map((catalog) => catalog.id);
    expect(requiring).toEqual([
      "competition_match_participants",
      "competition_rank",
    ]);
  });

  test("only player_groups uses group(…)", () => {
    const grouped = scoutQlSourceCatalogs()
      .filter((catalog) => catalog.groupCall)
      .map((catalog) => catalog.id);
    expect(grouped).toEqual(["player_groups"]);
  });

  test("player_groups filters game-level columns and aggregates member counters", () => {
    const catalog = scoutQlSourceCatalog("player_groups");
    expect(catalog?.columns.get("win")?.contexts).toEqual({
      select: true,
      where: true,
      groupBy: false,
    });
    expect(catalog?.columns.get("kills")?.contexts).toEqual({
      select: true,
      where: false,
      groupBy: false,
    });
    // Per-member identity has no answer for a group row.
    expect(catalog?.columns.has("champion_id")).toBe(false);
    expect(catalog?.columns.has("puuid")).toBe(false);
  });

  test("duration columns are marked as durations", () => {
    const catalog = scoutQlSourceCatalog("match_participants");
    for (const name of [
      "game_duration_seconds",
      "time_played",
      "total_time_spent_dead",
      "longest_time_spent_living",
      "time_ccing_others",
    ]) {
      expect(catalog?.columns.get(name)?.displayKind, name).toBe("duration");
    }
  });

  test("an unknown source name resolves to nothing", () => {
    expect(scoutQlSourceCatalog("matches")).toBeUndefined();
  });
});
