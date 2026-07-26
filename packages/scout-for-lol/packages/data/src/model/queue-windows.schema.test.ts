import { describe, expect, test } from "bun:test";
import queueWindowsJson from "#src/model/queue-windows.json" with { type: "json" };
import {
  QueueWindowsArraySchema,
  QueueWindowsFileSchema,
} from "#src/model/queue-windows.schema.ts";
import {
  QUEUE_AVAILABILITY,
  type QueueAvailability,
} from "#src/model/queue-availability.ts";
import { QueueTypeSchema } from "#src/model/state.ts";

describe("QueueWindowsFileSchema", () => {
  test("parses the committed queue-windows.json", () => {
    const parsed = QueueWindowsFileSchema.parse(queueWindowsJson);
    expect(Object.keys(parsed.queues).length).toBeGreaterThan(0);
  });

  test("defaults source to manual when omitted", () => {
    const parsed = QueueWindowsArraySchema.parse([
      { start: "2025-01-01", end: "2025-02-01" },
    ]);
    expect(parsed[0]?.source).toBe("manual");
  });

  test("rejects a non date-only start", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-1-1", end: null },
    ]);
    expect(result.success).toBe(false);
  });

  test("rejects windows that are not sorted ascending by start", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-03-01", end: "2025-03-10" },
      { start: "2025-01-01", end: "2025-01-10" },
    ]);
    expect(result.success).toBe(false);
  });

  test("rejects overlapping windows", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-01-01", end: "2025-02-01" },
      { start: "2025-01-15", end: "2025-03-01" },
    ]);
    expect(result.success).toBe(false);
  });

  test("rejects an end before its start", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-02-01", end: "2025-01-01" },
    ]);
    expect(result.success).toBe(false);
  });

  test("rejects more than one open-ended window", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-01-01", end: null },
      { start: "2025-06-01", end: null },
    ]);
    expect(result.success).toBe(false);
  });

  test("rejects an open-ended window that is not last", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-01-01", end: null },
      { start: "2025-06-01", end: "2025-07-01" },
    ]);
    expect(result.success).toBe(false);
  });

  test("accepts a single trailing open-ended window", () => {
    const result = QueueWindowsArraySchema.safeParse([
      { start: "2025-01-01", end: "2025-02-01" },
      { start: "2025-06-01", end: null },
    ]);
    expect(result.success).toBe(true);
  });
});

// Equivalence guard: the JSON-backed loader must reproduce exactly the window
// literals that lived inline in queue-availability.ts before the JSON split.
describe("QUEUE_AVAILABILITY equivalence with pre-split literals", () => {
  function limited(
    windows: [start: string, end: string | null][],
  ): QueueAvailability {
    return {
      kind: "limited",
      windows: windows.map(([start, end]) => ({
        start: new Date(start),
        // Ends are inclusive through the whole (UTC) end day, matching the
        // loader's semantics.
        end: end === null ? null : new Date(`${end}T23:59:59.999Z`),
      })),
    };
  }

  const PERMANENT: QueueAvailability = { kind: "permanent" };
  const DOOM_BOTS_2025 = limited([["2025-08-27", "2025-10-22"]]);

  const expected: Record<string, QueueAvailability> = {
    solo: PERMANENT,
    flex: PERMANENT,
    "ranked 5s": PERMANENT,
    clash: PERMANENT,
    "aram clash": PERMANENT,
    aram: PERMANENT,
    arurf: limited([
      ["2021-02-03", "2021-03-03"],
      ["2022-01-26", "2022-02-23"],
      ["2023-01-11", "2023-02-08"],
      ["2025-01-23", "2025-02-20"],
      ["2025-07-30", "2025-08-27"],
      ["2026-01-22", "2026-02-18"],
    ]),
    urf: limited([
      ["2014-04-03", "2014-04-13"],
      ["2019-10-28", "2019-11-08"],
      ["2025-11-19", "2025-12-10"],
    ]),
    quickplay: PERMANENT,
    swiftplay: PERMANENT,
    arena: limited([
      ["2023-07-20", "2023-08-28"],
      ["2023-12-07", "2024-01-08"],
      ["2024-05-01", "2024-09-24"],
      ["2025-03-01", "2025-05-14"],
      ["2025-06-25", null],
    ]),
    brawl: limited([
      ["2025-05-14", "2025-11-19"],
      ["2026-03-04", "2026-04-28"],
    ]),
    "aram mayhem": limited([["2025-10-22", null]]),
    "draft pick": PERMANENT,
    "easy doom bots": DOOM_BOTS_2025,
    "normal doom bots": DOOM_BOTS_2025,
    "hard doom bots": DOOM_BOTS_2025,
    custom: PERMANENT,
  };

  test("every queue matches the hardcoded expected availability", () => {
    for (const [key, availability] of Object.entries(expected)) {
      const queue = QueueTypeSchema.parse(key);
      const actual = QUEUE_AVAILABILITY[queue];
      // Compare kind + window Date epoch values for a stable deep equality.
      expect(actual.kind).toBe(availability.kind);
      if (actual.kind === "limited" && availability.kind === "limited") {
        expect(actual.windows.map((w) => w.start.getTime())).toEqual(
          availability.windows.map((w) => w.start.getTime()),
        );
        expect(
          actual.windows.map((w) => (w.end === null ? null : w.end.getTime())),
        ).toEqual(
          availability.windows.map((w) =>
            w.end === null ? null : w.end.getTime(),
          ),
        );
      }
    }
  });
});
