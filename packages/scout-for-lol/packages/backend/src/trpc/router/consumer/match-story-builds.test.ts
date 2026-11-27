import { describe, expect, test } from "vitest";
import type { StoryEvent } from "#src/reports/duckdb/consumer/match-story-reads.ts";
import {
  buildOrderFor,
  skillOrderFor,
} from "#src/trpc/router/consumer/match-story-builds.ts";

let counter = 0;

function event(
  ts: number,
  fields: Partial<StoryEvent> & { event_type: string },
): StoryEvent {
  counter += 1;
  return {
    event_id: `e${counter.toString()}`,
    event_timestamp_ms: ts,
    participant_id: 3,
    killer_id: null,
    victim_id: null,
    team_id: null,
    killer_team_id: null,
    item_id: null,
    before_id: null,
    after_id: null,
    skill_slot: null,
    level_up_type: null,
    building_type: null,
    lane_type: null,
    tower_type: null,
    monster_type: null,
    monster_sub_type: null,
    winning_team_id: null,
    ...fields,
  };
}

const MALIGNANCE = 3118;
const SORCERERS_SHOES = 3020;
const HEALTH_POTION = 2003;
const CONTROL_WARD = 2055;
const WARDING_TOTEM = 3340;
const DORANS_RING = 1056;
const NEEDLESSLY_LARGE_ROD = 1058;

function buy(ts: number, itemId: number): StoryEvent {
  return event(ts, { event_type: "ITEM_PURCHASED", item_id: itemId });
}

describe("buildOrderFor", () => {
  test("lists purchases in order with their minute and leaves out consumables and the trinket", () => {
    const steps = buildOrderFor([
      buy(8000, DORANS_RING),
      buy(9000, HEALTH_POTION),
      buy(10_000, WARDING_TOTEM),
      buy(570_000, MALIGNANCE),
      buy(600_000, CONTROL_WARD),
      buy(730_000, SORCERERS_SHOES),
    ]);
    expect(steps.map((step) => [step.itemId, step.minute, step.tier])).toEqual([
      [DORANS_RING, 0, "starter"],
      [MALIGNANCE, 9, "legendary"],
      [SORCERERS_SHOES, 12, "boots"],
    ]);
  });

  test("drops an undone purchase and keeps the one bought before it", () => {
    const steps = buildOrderFor([
      buy(100_000, NEEDLESSLY_LARGE_ROD),
      buy(300_000, NEEDLESSLY_LARGE_ROD),
      event(305_000, {
        event_type: "ITEM_UNDO",
        before_id: NEEDLESSLY_LARGE_ROD,
        after_id: 0,
      }),
      buy(400_000, MALIGNANCE),
    ]);
    expect(steps.map((step) => [step.itemId, step.timestampMs])).toEqual([
      [NEEDLESSLY_LARGE_ROD, 100_000],
      [MALIGNANCE, 400_000],
    ]);
  });

  test("an undo of an item never bought, or of a consumable, changes nothing", () => {
    const steps = buildOrderFor([
      buy(1000, HEALTH_POTION),
      event(2000, { event_type: "ITEM_UNDO", before_id: HEALTH_POTION }),
      event(3000, { event_type: "ITEM_UNDO", before_id: MALIGNANCE }),
      buy(4000, MALIGNANCE),
    ]);
    expect(steps.map((step) => step.itemId)).toEqual([MALIGNANCE]);
  });

  test("marks a sold item with when it was sold, and an undone sale restores it", () => {
    const sold = buildOrderFor([
      buy(8000, DORANS_RING),
      buy(500_000, MALIGNANCE),
      event(1_260_000, { event_type: "ITEM_SOLD", item_id: DORANS_RING }),
    ]);
    expect(sold.map((step) => [step.itemId, step.soldAtMs])).toEqual([
      [DORANS_RING, 1_260_000],
      [MALIGNANCE, null],
    ]);
    const restored = buildOrderFor([
      buy(8000, DORANS_RING),
      event(1_260_000, { event_type: "ITEM_SOLD", item_id: DORANS_RING }),
      event(1_262_000, {
        event_type: "ITEM_UNDO",
        before_id: 0,
        after_id: DORANS_RING,
      }),
    ]);
    expect(restored.map((step) => step.soldAtMs)).toEqual([null]);
  });

  test("a participant with no purchases has an empty build", () => {
    expect(buildOrderFor([])).toEqual([]);
  });
});

describe("skillOrderFor", () => {
  test("lists ability points in order and ignores evolutions", () => {
    const order = skillOrderFor([
      event(5000, {
        event_type: "SKILL_LEVEL_UP",
        skill_slot: 1,
        level_up_type: "NORMAL",
      }),
      event(105_000, {
        event_type: "SKILL_LEVEL_UP",
        skill_slot: 2,
        level_up_type: "NORMAL",
      }),
      event(205_000, {
        event_type: "SKILL_LEVEL_UP",
        skill_slot: 1,
        level_up_type: "EVOLVE",
      }),
      event(305_000, {
        event_type: "SKILL_LEVEL_UP",
        skill_slot: 4,
        level_up_type: "NORMAL",
      }),
    ]);
    expect(order).toEqual(["Q", "W", "R"]);
  });

  test("fails loudly on a slot that is not an ability", () => {
    expect(() =>
      skillOrderFor([
        event(5000, {
          event_type: "SKILL_LEVEL_UP",
          skill_slot: 9,
          level_up_type: "NORMAL",
        }),
      ]),
    ).toThrow(/unknown slot 9/);
  });
});
