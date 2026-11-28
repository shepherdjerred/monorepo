import { describe, expect, test } from "vitest";
import type { BuildEvent } from "#src/trpc/router/consumer/match-story-builds.ts";
import { coreBuildOf } from "#src/trpc/router/consumer/champion-builds/core-build.ts";

const MALIGNANCE = 3118;
const SHADOWFLAME = 4645;
const RABADONS = 3089;
const LICH_BANE = 3100;
const SORCERERS_SHOES = 3020;
const HEALTH_POTION = 2003;
const NEEDLESSLY_LARGE_ROD = 1058;

function event(
  ts: number,
  type: string,
  fields: Partial<BuildEvent> = {},
): BuildEvent {
  return {
    event_type: type,
    event_timestamp_ms: ts,
    item_id: null,
    before_id: null,
    after_id: null,
    ...fields,
  };
}

const buy = (ts: number, itemId: number) =>
  event(ts, "ITEM_PURCHASED", { item_id: itemId });

describe("coreBuildOf", () => {
  test("takes the first three finished items in purchase order", () => {
    expect(
      coreBuildOf([
        buy(1, HEALTH_POTION),
        buy(2, NEEDLESSLY_LARGE_ROD),
        buy(3, SORCERERS_SHOES),
        buy(4, MALIGNANCE),
        buy(5, SHADOWFLAME),
        buy(6, RABADONS),
        buy(7, LICH_BANE),
      ]),
    ).toEqual([MALIGNANCE, SHADOWFLAME, RABADONS]);
  });

  test("leaves out an undone purchase and an item that was sold", () => {
    expect(
      coreBuildOf([
        buy(1, LICH_BANE),
        event(2, "ITEM_UNDO", { before_id: LICH_BANE }),
        buy(3, MALIGNANCE),
        buy(4, SHADOWFLAME),
        event(5, "ITEM_SOLD", { item_id: SHADOWFLAME }),
        buy(6, RABADONS),
        buy(7, LICH_BANE),
      ]),
    ).toEqual([MALIGNANCE, RABADONS, LICH_BANE]);
  });

  test("is null with fewer than three finished items", () => {
    expect(coreBuildOf([])).toBeNull();
    expect(
      coreBuildOf([
        buy(1, MALIGNANCE),
        buy(2, SHADOWFLAME),
        buy(3, SORCERERS_SHOES),
      ]),
    ).toBeNull();
  });
});
