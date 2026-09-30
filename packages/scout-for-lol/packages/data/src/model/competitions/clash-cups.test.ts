import { describe, expect, test } from "vitest";
import clashCupsJson from "#src/model/competitions/clash-cups.json" with { type: "json" };
import {
  ClashCupsFileSchema,
  ClashCupSchema,
} from "#src/model/competitions/clash-cups.schema.ts";
import { resolveClashCupFromCalendar } from "#src/model/competitions/clash-cups.ts";

describe("ClashCupsFileSchema", () => {
  test("parses the committed clash-cups.json", () => {
    const parsed = ClashCupsFileSchema.parse(clashCupsJson);
    expect(parsed.cups.length).toBeGreaterThan(0);
  });

  test("rejects sunday on or before saturday", () => {
    const result = ClashCupSchema.safeParse({
      nameKey: "zaun",
      queue: "clash",
      saturday: "2026-05-10",
      sunday: "2026-05-09",
    });
    expect(result.success).toBe(false);
  });

  test("rejects cups that are not sorted by saturday", () => {
    const result = ClashCupsFileSchema.safeParse({
      cups: [
        {
          nameKey: "zaun",
          queue: "clash",
          saturday: "2026-05-09",
          sunday: "2026-05-10",
        },
        {
          nameKey: "demacia",
          queue: "clash",
          saturday: "2026-01-24",
          sunday: "2026-01-25",
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("resolveClashCupFromCalendar", () => {
  test("maps Bandle City 2026-09-19/20 queue 700 weekends", () => {
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-09-19T18:00:00.000Z"),
        platform: "NA1",
      }),
    ).toEqual({
      nameKey: "bandle_city",
      cupDay: "day_1",
      queue: "clash",
    });
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-09-20T02:15:00.000Z"),
        platform: "NA1",
      }),
    ).toEqual({
      nameKey: "bandle_city",
      cupDay: "day_1",
      queue: "clash",
    });
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date(1_789_867_832_147),
        platform: "NA1",
      }),
    ).toEqual({
      nameKey: "bandle_city",
      cupDay: "day_1",
      queue: "clash",
    });
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-09-21T01:30:00.000Z"),
        platform: "NA1",
      }),
    ).toEqual({
      nameKey: "bandle_city",
      cupDay: "day_2",
      queue: "clash",
    });
  });

  test("maps Zaun May 9-10 and Void ARAM Jun 20-21", () => {
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-05-09T16:00:00.000Z"),
        platform: "EUW1",
      })?.nameKey,
    ).toBe("zaun");
    expect(
      resolveClashCupFromCalendar({
        queue: "aram clash",
        at: new Date("2026-06-20T16:00:00.000Z"),
        platform: "NA1",
      }),
    ).toEqual({
      nameKey: "the_void",
      cupDay: "day_1",
      queue: "aram clash",
    });
  });

  test("does not attach Makeup Clash to NA", () => {
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-02-07T18:00:00.000Z"),
        platform: "NA1",
      }),
    ).toBeUndefined();
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-02-07T18:00:00.000Z"),
        platform: "EUW1",
      }),
    ).toEqual({
      nameKey: "makeup",
      cupDay: "day_1",
      queue: "clash",
    });
  });

  test("ignores non-Clash queues and dates outside a cup weekend", () => {
    expect(
      resolveClashCupFromCalendar({
        queue: "solo",
        at: new Date("2026-09-19T18:00:00.000Z"),
        platform: "NA1",
      }),
    ).toBeUndefined();
    expect(
      resolveClashCupFromCalendar({
        queue: "clash",
        at: new Date("2026-09-22T18:00:00.000Z"),
        platform: "NA1",
      }),
    ).toBeUndefined();
  });
});
