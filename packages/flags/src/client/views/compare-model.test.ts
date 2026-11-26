import { expect, test } from "vitest";
import type { FlagValue } from "@shepherdjerred/feature-flags/evaluate.ts";
import {
  comparePair,
  comparePath,
  countRows,
  diffDocuments,
  pairedStage,
  statusLabel,
  visibleRows,
} from "./compare-model.ts";

const on: FlagValue = {
  type: "boolean",
  key: "dares",
  default: true,
  rollouts: [],
};
const off: FlagValue = { ...on, default: false };
const targeted: FlagValue = {
  ...off,
  rollouts: [{ constraints: [{ property: "user", value: "1" }], result: true }],
};
const budget = (value: string): FlagValue => ({
  type: "variant",
  key: "budget",
  value,
});

test("diffDocuments sorts every key and classifies each side", () => {
  const rows = diffDocuments(
    {
      flags: [
        budget("500"),
        on,
        { type: "variant", key: "only_left", value: "" },
      ],
    },
    {
      flags: [
        { type: "boolean", key: "a_right", default: false, rollouts: [] },
        budget("500"),
        off,
      ],
    },
  );
  expect(rows.map((row) => [row.key, row.status])).toEqual([
    ["a_right", "only-right"],
    ["budget", "same"],
    ["dares", "differs"],
    ["only_left", "only-left"],
  ]);
  expect(rows[0]?.left).toBeUndefined();
  expect(rows[0]?.right).toEqual({
    type: "boolean",
    key: "a_right",
    default: false,
    rollouts: [],
  });
  expect(rows[2]).toEqual({
    key: "dares",
    status: "differs",
    left: on,
    right: off,
  });
  expect(countRows(rows)).toEqual({
    "only-left": 1,
    "only-right": 1,
    differs: 1,
    same: 1,
  });
});

test("flag equality covers segments and variant values", () => {
  const [segment] = diffDocuments({ flags: [off] }, { flags: [targeted] });
  expect(segment?.status).toBe("differs");
  const [same] = diffDocuments({ flags: [targeted] }, { flags: [targeted] });
  expect(same?.status).toBe("same");
  const [value] = diffDocuments(
    { flags: [budget("1")] },
    { flags: [budget("2")] },
  );
  expect(value?.status).toBe("differs");
  expect(diffDocuments({ flags: [] }, { flags: [] })).toEqual([]);
});

test("visibleRows hides identical flags unless asked and filters by key", () => {
  const rows = diffDocuments(
    { flags: [budget("1"), on] },
    { flags: [budget("1"), off] },
  );
  expect(
    visibleRows(rows, { showSame: false, query: "" }).map((row) => row.key),
  ).toEqual(["dares"]);
  expect(
    visibleRows(rows, { showSame: true, query: "" }).map((row) => row.key),
  ).toEqual(["budget", "dares"]);
  expect(
    visibleRows(rows, { showSame: true, query: " BUD " }).map((row) => row.key),
  ).toEqual(["budget"]);
});

const ids = ["golink/prod", "scout/beta", "scout/prod", "tracker/prod"];

test("pairedStage finds a catalog's other stage", () => {
  expect(pairedStage(ids, "scout/beta")).toBe("scout/prod");
  expect(pairedStage(ids, "scout/prod")).toBe("scout/beta");
  expect(pairedStage(ids, "golink/prod")).toBeUndefined();
});

test("comparePair keeps known choices and fills sensible defaults", () => {
  expect(comparePair(ids, {})).toEqual({
    left: "scout/beta",
    right: "scout/prod",
  });
  expect(comparePair(ids, { left: "scout/prod" })).toEqual({
    left: "scout/prod",
    right: "scout/beta",
  });
  expect(comparePair(ids, { left: "golink/prod" })).toEqual({
    left: "golink/prod",
    right: "scout/beta",
  });
  expect(comparePair(ids, { right: "scout/beta" })).toEqual({
    left: "scout/prod",
    right: "scout/beta",
  });
  expect(
    comparePair(ids, { left: "tracker/prod", right: "golink/prod" }),
  ).toEqual({ left: "tracker/prod", right: "golink/prod" });
  // Unknown ids fall back as if absent.
  expect(comparePair(ids, { left: "nope/prod", right: "nope/beta" })).toEqual({
    left: "scout/beta",
    right: "scout/prod",
  });
  expect(comparePair(["b/prod", "a/prod"], {})).toEqual({
    left: "a/prod",
    right: "b/prod",
  });
  expect(comparePair(["a/prod"], {})).toBeUndefined();
});

test("comparePath and statusLabel", () => {
  expect(comparePath("scout/beta", "scout/prod")).toBe(
    "/compare?left=scout%2Fbeta&right=scout%2Fprod",
  );
  expect(comparePath("scout/beta", "scout/prod", { key: "a b" })).toBe(
    "/compare?left=scout%2Fbeta&right=scout%2Fprod&key=a+b",
  );
  expect(statusLabel("only-left", "Beta", "Prod")).toBe("Only in Beta");
  expect(statusLabel("only-right", "Beta", "Prod")).toBe("Only in Prod");
  expect(statusLabel("differs", "Beta", "Prod")).toBe("Differs");
  expect(statusLabel("same", "Beta", "Prod")).toBe("Same");
});
