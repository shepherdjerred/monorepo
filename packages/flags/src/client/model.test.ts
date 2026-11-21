import { expect, test } from "vitest";
import {
  addSegment,
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
