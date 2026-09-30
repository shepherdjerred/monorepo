import { describe, expect, test } from "vitest";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import { reportAssetInfo } from "@scout-for-lol/data/model/reports/report-assets.ts";
import {
  planResultColumns,
  planResultDimensions,
} from "#src/reports/query/plan-columns.ts";

describe("plan result asset metadata", () => {
  test("marks an identifier-backed asset grouping and its echoed output", () => {
    const plan = {
      source: "match_participants",
      outputs: [
        {
          name: "perk0",
          expr: { kind: "grouping-ref", index: 0 },
          displayKind: "text",
          additive: false,
          evidence: { kind: "sample" },
        },
      ],
      groupings: [{ kind: "column", column: "perk0", name: "perk0" }],
      timeWindow: { kind: "unbounded" },
      orderBy: [],
      limit: 10,
      playerRefs: [],
      render: { kind: "TABLE" },
    } satisfies ScoutQlPlan;

    expect(planResultColumns(plan, ["label", "perk0"])).toEqual([
      {
        key: "label",
        label: "Perk0",
        format: "text",
      },
      {
        key: "perk0",
        label: "Perk0",
        format: "text",
        asset: "rune",
      },
    ]);
  });

  test("keeps name-backed asset groupings as display text", () => {
    const plan = {
      source: "match_participants",
      outputs: [
        {
          name: "summoner1",
          expr: { kind: "grouping-ref", index: 0 },
          displayKind: "text",
          additive: false,
          evidence: { kind: "sample" },
        },
      ],
      groupings: [{ kind: "column", column: "summoner1", name: "summoner1" }],
      timeWindow: { kind: "unbounded" },
      orderBy: [],
      limit: 10,
      playerRefs: [],
      render: { kind: "TABLE" },
    } satisfies ScoutQlPlan;

    expect(planResultColumns(plan, ["label", "summoner1"])).toEqual([
      { key: "label", label: "Summoner1", format: "text" },
      { key: "summoner1", label: "Summoner1", format: "text" },
    ]);
    expect(planResultDimensions(plan, "Flash", ["Flash"])).toEqual(["Flash"]);
  });

  test.each([
    { source: "match_participants", key: 62 },
    { source: "prematch_participants", key: "62" },
    { source: "match_team_bans", key: 62 },
    { source: "timeline_frames", key: 62 },
    { source: "timeline_events", key: 62 },
  ] as const)(
    "formats champion grouping keys from $source",
    ({ source, key }) => {
      const plan = {
        source,
        outputs: [
          {
            name: "champion",
            expr: { kind: "grouping-ref", index: 0 },
            displayKind: "text",
            additive: false,
            evidence: { kind: "sample" },
          },
        ],
        groupings: [{ kind: "column", column: "champion", name: "champion" }],
        timeWindow: { kind: "unbounded" },
        orderBy: [],
        limit: 10,
        playerRefs: [],
        render: { kind: "TABLE" },
      } satisfies ScoutQlPlan;

      expect(planResultColumns(plan, ["label", "champion"])).toEqual([
        { key: "label", label: "Champion", format: "text" },
        {
          key: "champion",
          label: "Champion",
          format: "text",
          asset: "champion",
        },
      ]);
      expect(planResultDimensions(plan, String(key), [key])).toEqual([
        reportAssetInfo("champion", Number(key)).name,
      ]);
    },
  );

  test("formats asset dimensions in composite labels from typed grouping keys", () => {
    const plan = {
      source: "match_participants",
      outputs: [],
      groupings: [
        { kind: "column", column: "item0", name: "item0" },
        { kind: "column", column: "queue", name: "queue" },
      ],
      timeWindow: { kind: "unbounded" },
      orderBy: [],
      limit: 10,
      playerRefs: [],
      render: { kind: "TABLE" },
    } satisfies ScoutQlPlan;

    const dimensions = planResultDimensions(plan, "3031 • solo", [
      3031,
      "solo",
    ]);
    expect(dimensions).toEqual(["Infinity Edge", "solo"]);
    expect(dimensions.join(" • ")).toBe("Infinity Edge • solo");
  });

  test("keeps the grand-total label when a plan has no groupings", () => {
    const plan = {
      source: "match_participants",
      outputs: [],
      groupings: [],
      timeWindow: { kind: "unbounded" },
      orderBy: [],
      limit: 10,
      playerRefs: [],
      render: { kind: "TABLE" },
    } satisfies ScoutQlPlan;

    expect(planResultDimensions(plan, "All", [])).toEqual(["All"]);
  });

  test("does not attach assets to aggregate metrics that read an asset id", () => {
    const plan = {
      source: "match_participants",
      outputs: [
        {
          name: "games",
          expr: {
            kind: "aggregate",
            func: "count",
            arg: { kind: "column", column: "kills" },
            distinct: false,
          },
          displayKind: "count",
          additive: true,
          evidence: { kind: "sample" },
        },
      ],
      groupings: [],
      timeWindow: { kind: "unbounded" },
      orderBy: [],
      limit: 10,
      playerRefs: [],
      render: { kind: "TABLE" },
    } satisfies ScoutQlPlan;

    expect(planResultColumns(plan, ["label", "games"])).toEqual([
      { key: "label", label: "Label", format: "text" },
      { key: "games", label: "Games", format: "integer" },
    ]);
  });
});
