import { expect, test } from "vitest";
import { observedClashEntity } from "./clash-entities.ts";

test("addresses primary and referenced rosters independently", () => {
  expect(
    observedClashEntity({
      resource: "clash_roster",
      data: { id: "own", tournamentId: 12 },
    }),
  ).toEqual({
    resource: "clash_roster",
    entityId: "own",
    tournamentId: "12",
    isPrimary: true,
  });
  expect(
    observedClashEntity({
      resource: "clash_roster:opponent",
      data: { id: "opponent", tournamentId: 12 },
    })?.isPrimary,
  ).toBe(false);
  expect(
    observedClashEntity({
      resource: "clash_roster:wrong",
      data: { id: "own" },
    }),
  ).toBeNull();
  expect(
    observedClashEntity({ resource: "clash_player", data: { id: "own" } }),
  ).toBeNull();
  expect(
    observedClashEntity({
      resource: "clash_roster",
      data: { unrelated: { id: "own" } },
    }),
  ).toBeNull();
});
