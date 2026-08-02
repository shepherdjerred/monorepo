import { describe, expect, test } from "bun:test";
import {
  isCompetitionQueueCurrentlyAvailable,
  isQueueCurrentlyAvailable,
  QUEUE_AVAILABILITY,
  queueAvailabilityNote,
} from "#src/model/queue-availability.ts";
import { QueueTypeSchema } from "#src/model/state.ts";
import { CompetitionQueueTypeSchema } from "#src/model/competition.ts";

describe("QUEUE_AVAILABILITY", () => {
  test("covers every queue type", () => {
    for (const queue of QueueTypeSchema.options) {
      expect(QUEUE_AVAILABILITY[queue]).toBeDefined();
    }
  });

  test("limited windows are internally ordered (start before end)", () => {
    for (const queue of QueueTypeSchema.options) {
      const availability = QUEUE_AVAILABILITY[queue];
      if (availability.kind !== "limited") continue;
      for (const window of availability.windows) {
        expect(Number.isNaN(window.start.getTime())).toBe(false);
        if (window.end !== null) {
          expect(window.start < window.end).toBe(true);
        }
      }
    }
  });
});

describe("isQueueCurrentlyAvailable", () => {
  test("permanent queues are always available", () => {
    expect(
      isQueueCurrentlyAvailable("solo", new Date("1999-01-01T00:00:00Z")),
    ).toBe(true);
  });

  test("open-ended windows count as available", () => {
    // Arena's current run started 2025-06-25 with no announced end.
    expect(
      isQueueCurrentlyAvailable("arena", new Date("2026-07-26T00:00:00Z")),
    ).toBe(true);
  });

  test("window boundaries are inclusive", () => {
    expect(
      isQueueCurrentlyAvailable("brawl", new Date("2026-03-04T00:00:00Z")),
    ).toBe(true);
    expect(
      isQueueCurrentlyAvailable("brawl", new Date("2026-04-28T00:00:00Z")),
    ).toBe(true);
    expect(
      isQueueCurrentlyAvailable("brawl", new Date("2026-04-29T00:00:00Z")),
    ).toBe(false);
  });

  test("multiple windows: between runs is unavailable, inside either is available", () => {
    expect(
      isQueueCurrentlyAvailable("brawl", new Date("2025-06-01T00:00:00Z")),
    ).toBe(true);
    expect(
      isQueueCurrentlyAvailable("brawl", new Date("2026-01-01T00:00:00Z")),
    ).toBe(false);
  });

  test("before the first window is unavailable", () => {
    expect(
      isQueueCurrentlyAvailable("brawl", new Date("2025-01-01T00:00:00Z")),
    ).toBe(false);
  });

  test("Classic starts on launch day and remains open-ended", () => {
    expect(
      isQueueCurrentlyAvailable("classic", new Date("2026-07-28T23:59:59Z")),
    ).toBe(false);
    expect(
      isQueueCurrentlyAvailable("classic", new Date("2026-07-29T00:00:00Z")),
    ).toBe(true);
    expect(
      isQueueCurrentlyAvailable("classic", new Date("2027-07-29T00:00:00Z")),
    ).toBe(true);
  });
});

describe("queueAvailabilityNote", () => {
  test("undefined for permanent and currently-live queues", () => {
    const now = new Date("2026-07-26T00:00:00Z");
    expect(queueAvailabilityNote("solo", now)).toBeUndefined();
    expect(queueAvailabilityNote("arena", now)).toBeUndefined();
  });

  test("present for limited queues that are not live", () => {
    const now = new Date("2026-07-26T00:00:00Z");
    expect(queueAvailabilityNote("urf", now)).toContain("Limited-time");
    expect(queueAvailabilityNote("brawl", now)).toContain("Limited-time");
  });
});

describe("isCompetitionQueueCurrentlyAvailable", () => {
  const now = new Date("2026-07-26T00:00:00Z");

  test("aggregate choices are always available", () => {
    for (const queue of ["ALL", "RANKED_ANY", "CUSTOM"] as const) {
      expect(isCompetitionQueueCurrentlyAvailable(queue, now)).toBe(true);
    }
  });

  test("maps limited modes through to match-queue windows", () => {
    expect(isCompetitionQueueCurrentlyAvailable("ARENA", now)).toBe(true);
    expect(isCompetitionQueueCurrentlyAvailable("URF", now)).toBe(false);
    expect(isCompetitionQueueCurrentlyAvailable("BRAWL", now)).toBe(false);
  });

  test("every competition queue has a mapping", () => {
    for (const queue of CompetitionQueueTypeSchema.options) {
      expect(typeof isCompetitionQueueCurrentlyAvailable(queue, now)).toBe(
        "boolean",
      );
    }
  });
});
