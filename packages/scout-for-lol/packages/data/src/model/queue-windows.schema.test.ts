import { describe, expect, test } from "bun:test";
import queueWindowsJson from "#src/model/queue-windows.json" with { type: "json" };
import {
  QueueWindowsArraySchema,
  QueueWindowsFileSchema,
} from "#src/model/queue-windows.schema.ts";
import { QUEUE_AVAILABILITY } from "#src/model/queue-availability.ts";
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

// Round-trip guard: the loader must reproduce queue-windows.json exactly —
// day-start starts, end-of-day-inclusive ends — for every limited queue, and
// every limited queue must have JSON data. (The watcher edits the JSON, so
// this intentionally asserts loader↔JSON agreement, not a fixed snapshot.)
describe("QUEUE_AVAILABILITY round-trips queue-windows.json", () => {
  const file = QueueWindowsFileSchema.parse(queueWindowsJson);

  test("every limited queue matches its JSON windows with end-of-day ends", () => {
    for (const [key, windows] of Object.entries(file.queues)) {
      const queue = QueueTypeSchema.parse(key);
      const availability = QUEUE_AVAILABILITY[queue];
      expect(availability.kind).toBe("limited");
      if (availability.kind !== "limited") continue;
      expect(availability.windows.map((w) => w.start.getTime())).toEqual(
        windows.map((w) => new Date(w.start).getTime()),
      );
      expect(
        availability.windows.map((w) =>
          w.end === null ? null : w.end.getTime(),
        ),
      ).toEqual(
        windows.map((w) =>
          w.end === null ? null : new Date(`${w.end}T23:59:59.999Z`).getTime(),
        ),
      );
    }
  });

  test("every limited queue in the availability record has JSON data", () => {
    for (const queue of QueueTypeSchema.options) {
      if (QUEUE_AVAILABILITY[queue].kind === "limited") {
        expect(file.queues[queue]).toBeDefined();
      }
    }
  });
});
