import { describe, expect, test } from "vitest";
import type { ScoutQlPlan } from "@scout-for-lol/data/model/scoutql/parse/plan.ts";
import { planResultColumns } from "#src/reports/query/plan-columns.ts";

describe("plan result asset metadata", () => {
  test("marks an asset grouping and its echoed output", () => {
    const plan = {
      source: "match_participants",
      outputs: [
        {
          name: "keystone",
          expr: { kind: "grouping-ref", index: 0 },
          displayKind: "text",
          additive: false,
          evidence: { kind: "sample" },
        },
      ],
      groupings: [{ kind: "column", column: "keystone", name: "keystone" }],
      timeWindow: { kind: "unbounded" },
      orderBy: [],
      limit: 10,
      playerRefs: [],
      render: { kind: "TABLE" },
    } satisfies ScoutQlPlan;

    expect(planResultColumns(plan, ["label", "keystone"])).toEqual([
      {
        key: "label",
        label: "Keystone",
        format: "text",
        asset: "rune",
      },
      {
        key: "keystone",
        label: "Keystone",
        format: "text",
        asset: "rune",
      },
    ]);
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
