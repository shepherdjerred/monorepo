import { expect, test } from "vitest";
import {
  addSegment,
  deploymentPath,
  filterFlags,
  flagPath,
  flagState,
  pageTitle,
  searchSuffix,
  draftError,
  listState,
  sameFlag,
  sidebarEntries,
  withQuery,
} from "./model.ts";

test("builds deployment and flag paths with encoded segments", () => {
  expect(deploymentPath("scout", "prod")).toBe("/scout/prod");
  expect(flagPath("scout", "prod", "dares_enabled")).toBe(
    "/scout/prod/dares_enabled",
  );
  expect(flagPath("scout", "prod", "a/b")).toBe("/scout/prod/a%2Fb");
});

test("the tab title names the flag and deployment, most specific first", () => {
  expect(pageTitle(undefined)).toBe("Flags");
  expect(pageTitle({ catalog: "scout", stage: "prod" })).toBe(
    "scout/prod · Flags",
  );
  expect(pageTitle({ catalog: "scout", stage: "prod", key: "dares" })).toBe(
    "dares · scout/prod · Flags",
  );
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
  // The field's own params keep the text as typed and drop an empty search.
  const page = new URLSearchParams("q=old&tab=x");
  expect(withQuery(page, "a ").get("q")).toBe("a ");
  expect(withQuery(page, "a ").get("tab")).toBe("x");
  expect(withQuery(page, "").has("q")).toBe(false);
  expect(page.get("q")).toBe("old");
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
