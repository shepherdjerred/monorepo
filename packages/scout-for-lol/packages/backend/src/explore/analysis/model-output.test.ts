import { expect, test } from "vitest";
import {
  ANALYSIS_OUTPUT_BYTES,
  analysisOutputForModel,
  jsonValuePage,
  queryDatasetRows,
} from "./model-output.ts";

test("keeps canonical identities separate from display labels across accounts", () => {
  const rows = ["account-a", "account-b"].map((account) => ({
    keys: ["345", account, "EUW1_1"],
    dimensions: ["Pyxi#EUW", account, "EUW1_1"],
    values: [{ column: "win", value: 1 }],
  }));
  expect(queryDatasetRows(["player", "puuid", "match_id"], rows)).toEqual(
    rows.map((row) => ({
      player: "345",
      puuid: row.keys[1],
      match_id: "EUW1_1",
      win: 1,
      __group_labels: {
        player: "Pyxi#EUW",
        puuid: row.keys[1],
        match_id: "EUW1_1",
      },
    })),
  );
});

test("value pages preserve every row with variable byte-bound offsets", () => {
  const values = Array.from({ length: 23 }, (_, index) => ({
    index,
    text: "x".repeat(1500),
  }));
  const collected = [];
  let offset = 0;
  while (offset < values.length) {
    const page = jsonValuePage(values, offset);
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeLessThanOrEqual(ANALYSIS_OUTPUT_BYTES);
    expect(page.length).toBeGreaterThan(0);
    collected.push(...page);
    offset += page.length;
  }
  expect(collected).toEqual(values);
  expect(jsonValuePage(values, values.length)).toEqual([]);
  expect(() => jsonValuePage(["😀".repeat(2100)], 0)).toThrow(
    "scalar child fields",
  );
});

test("rejects reserved field collisions and broken grouping contracts", () => {
  expect(() => queryDatasetRows(["__group_labels"], [])).toThrow("reserved");
  expect(() =>
    queryDatasetRows(
      [],
      [
        {
          keys: [],
          dimensions: [],
          values: [{ column: "__group_labels", value: 1 }],
        },
      ],
    ),
  ).toThrow("reserved");
  expect(() =>
    queryDatasetRows(
      ["player"],
      [{ keys: ["345"], dimensions: [], values: [] }],
    ),
  ).toThrow("align");
});

test("preserves ungrouped totals with the report's All display label", () => {
  expect(
    queryDatasetRows(
      [],
      [
        {
          keys: [],
          dimensions: ["All"],
          values: [{ column: "games", value: 53 }],
        },
      ],
    ),
  ).toEqual([{ games: 53, __group_labels: {} }]);
});

test("accepts exactly the byte limit and rejects larger UTF-8 results without truncation", () => {
  const overhead = new TextEncoder().encode(
    JSON.stringify({ ok: true, value: "" }),
  ).byteLength;
  const result = {
    ok: true as const,
    value: "x".repeat(ANALYSIS_OUTPUT_BYTES - overhead),
  };
  expect(analysisOutputForModel(result)).toEqual(result);
  expect(
    analysisOutputForModel({ ...result, value: `${result.value}x` }),
  ).toMatchObject({ ok: false, message: expect.stringContaining("8 KiB") });
  expect(
    analysisOutputForModel({ ok: true, value: "😀".repeat(2100) }),
  ).toMatchObject({ ok: false });
  expect(
    analysisOutputForModel({ ok: false, message: "Analysis is busy." }),
  ).toEqual({ ok: false, message: "Analysis is busy." });
});
