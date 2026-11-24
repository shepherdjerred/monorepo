import { expect, test } from "vitest";
import {
  addSegment,
  filterFlags,
  flagState,
  parseSearch,
  searchSuffix,
  draftError,
  listState,
  parseRoute,
  sameFlag,
  sidebarEntries,
} from "./model.ts";

test("parses a deployment and an encoded flag key", () => {
  expect(parseRoute("/")).toBeUndefined();
  expect(parseRoute("/scout/prod")).toEqual({
    catalog: "scout",
    stage: "prod",
  });
  expect(parseRoute("/scout/prod/dares_enabled")).toEqual({
    catalog: "scout",
    stage: "prod",
    key: "dares_enabled",
  });
  expect(parseRoute("/scout/prod/a%2Fb")).toEqual({
    catalog: "scout",
    stage: "prod",
    key: "a/b",
  });
});

test("prod-only catalogs are one row and two-stage catalogs stay grouped", () => {
  expect(
    sidebarEntries([
      "tracker/prod",
      "scout/prod",
      "scout/beta",
      "minecraft/tsmc",
    ]),
  ).toEqual([
    { kind: "single", id: "minecraft/tsmc", label: "minecraft/tsmc" },
    {
      kind: "group",
      catalog: "scout",
      stages: [
        { id: "scout/beta", label: "Beta" },
        { id: "scout/prod", label: "Prod" },
      ],
    },
    { kind: "single", id: "tracker/prod", label: "tracker" },
  ]);
});

test("lists boolean presence and the variant string", () => {
  expect(
    listState({ type: "boolean", key: "a", default: true, rollouts: [] }),
  ).toBe("On");
  expect(
    listState({ type: "boolean", key: "a", default: false, rollouts: [] }),
  ).toBe("Off");
  expect(
    listState({
      type: "boolean",
      key: "a",
      default: false,
      rollouts: [
        { constraints: [{ property: "stage", value: "beta" }], result: true },
      ],
    }),
  ).toBe("Targeted");
  expect(
    listState({ type: "variant", key: "model", value: "gpt-6-luna" }),
  ).toBe("gpt-6-luna");
});

test("rejects a segment that cannot match", () => {
  const blank = addSegment({
    type: "boolean",
    key: "a",
    default: false,
    rollouts: [],
  });
  expect(draftError(blank)).toBe("Segment 1 has an empty constraint");
  expect(
    draftError({ type: "variant", key: "model", value: "" }),
  ).toBeUndefined();
  expect(
    sameFlag(
      { type: "boolean", key: "a", default: true, rollouts: [] },
      { type: "boolean", key: "a", default: false, rollouts: [] },
    ),
  ).toBe(false);
});

test("search filters flags by key, ignoring case and surrounding spaces", () => {
  const flags = [
    { key: "Dares_Enabled" },
    { key: "debug" },
    { key: "llm-daily-token-budget" },
  ];
  expect(filterFlags(flags, "")).toEqual(flags);
  expect(filterFlags(flags, "  ")).toEqual(flags);
  expect(filterFlags(flags, "DARES")).toEqual([{ key: "Dares_Enabled" }]);
  expect(filterFlags(flags, " d ")).toEqual(flags);
  expect(filterFlags(flags, "token")).toEqual([
    { key: "llm-daily-token-budget" },
  ]);
  expect(filterFlags(flags, "zzz")).toEqual([]);
});

test("the search round-trips through the page URL", () => {
  expect(searchSuffix("")).toBe("");
  expect(searchSuffix(" a b ")).toBe("?q=a%20b");
  expect(parseSearch("?q=a%20b")).toBe("a b");
  expect(parseSearch("")).toBe("");
});

test("flag state splits into a glyph kind and the word shown", () => {
  expect(
    flagState({ type: "boolean", key: "a", default: true, rollouts: [] }),
  ).toEqual({ kind: "on", label: "On" });
  expect(
    flagState({ type: "boolean", key: "a", default: false, rollouts: [] }),
  ).toEqual({ kind: "off", label: "Off" });
  expect(flagState({ type: "variant", key: "v", value: "" })).toEqual({
    kind: "variant",
    label: "(empty)",
  });
});
