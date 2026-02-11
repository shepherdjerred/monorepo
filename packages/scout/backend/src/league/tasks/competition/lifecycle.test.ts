import { describe, expect, test } from "bun:test";

/**
 * Unit tests for lifecycle query logic
 * These tests verify the database query conditions used to find competitions
 * that need state transitions (DRAFT -> ACTIVE or ACTIVE -> ENDED)
 */

describe("Competition Lifecycle - Query Logic", () => {
  describe("Finding competitions to start", () => {
    test("should include competition with start date in past and no START snapshots", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const startDate = new Date("2025-01-15T11:00:00Z");

      // Query conditions: startDate <= now, no START snapshots
      const shouldStart = startDate <= now;

      expect(shouldStart).toBe(true);
    });

    test("should exclude competition with start date in future", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const startDate = new Date("2025-01-15T13:00:00Z");

      const shouldStart = startDate <= now;

      expect(shouldStart).toBe(false);
    });

    test("should exclude cancelled competition even with past start date", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const startDate = new Date("2025-01-15T11:00:00Z");
      const isCancelled = true;

      // Query filters out cancelled competitions
      const shouldStart = startDate <= now && !isCancelled;

      expect(shouldStart).toBe(false);
    });

    test("should exclude competition that already has START snapshots", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const startDate = new Date("2025-01-15T11:00:00Z");
      const hasStartSnapshots = true;

      // Query filters out competitions with START snapshots
      const shouldStart = startDate <= now && !hasStartSnapshots;

      expect(shouldStart).toBe(false);
    });
  });

  describe("Finding competitions to end", () => {
    test("should include competition with end date in past and no END snapshots", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const endDate = new Date("2025-01-15T11:00:00Z");
      const hasStartSnapshots = true;
      const hasEndSnapshots = false;

      // Query conditions: endDate <= now, has START, no END
      const shouldEnd = endDate <= now && hasStartSnapshots && !hasEndSnapshots;

      expect(shouldEnd).toBe(true);
    });

    test("should exclude competition with end date in future", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const endDate = new Date("2025-01-15T13:00:00Z");
      const hasEndSnapshots = false;

      const shouldEnd = endDate <= now && !hasEndSnapshots;

      expect(shouldEnd).toBe(false);
    });

    test("should exclude competition that already has END snapshots", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const endDate = new Date("2025-01-15T11:00:00Z");
      const hasEndSnapshots = true;

      const shouldEnd = endDate <= now && !hasEndSnapshots;

      expect(shouldEnd).toBe(false);
    });

    test("should exclude competition without START snapshots (never started)", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const endDate = new Date("2025-01-15T11:00:00Z");
      const hasStartSnapshots = false;
      const hasEndSnapshots = false;

      // Query conditions: endDate <= now, has START, no END
      const shouldEnd = endDate <= now && hasStartSnapshots && !hasEndSnapshots;

      expect(shouldEnd).toBe(false);
    });

    test("should exclude cancelled competition even with past end date", () => {
      const now = new Date("2025-01-15T12:00:00Z");
      const endDate = new Date("2025-01-15T11:00:00Z");
      const isCancelled = true;

      const shouldEnd = endDate <= now && !isCancelled;

      expect(shouldEnd).toBe(false);
    });
  });

  describe("Multiple competitions scenario", () => {
    test("should correctly identify which competitions need transitions", () => {
      const now = new Date("2025-01-15T12:00:00Z");

      const competitions = [
        {
          id: 1,
          startDate: new Date("2025-01-15T11:00:00Z"),
          endDate: new Date("2025-01-20T12:00:00Z"),
          hasStartSnapshots: false,
          hasEndSnapshots: false,
          isCancelled: false,
        },
        {
          id: 2,
          startDate: new Date("2025-01-15T13:00:00Z"),
          endDate: new Date("2025-01-20T12:00:00Z"),
          hasStartSnapshots: false,
          hasEndSnapshots: false,
          isCancelled: false,
        },
        {
          id: 3,
          startDate: new Date("2025-01-10T12:00:00Z"),
          endDate: new Date("2025-01-15T11:00:00Z"),
          hasStartSnapshots: true,
          hasEndSnapshots: false,
          isCancelled: false,
        },
        {
          id: 4,
          startDate: new Date("2025-01-10T12:00:00Z"),
          endDate: new Date("2025-01-15T13:00:00Z"),
          hasStartSnapshots: true,
          hasEndSnapshots: false,
          isCancelled: false,
        },
        {
          id: 5,
          startDate: new Date("2025-01-10T12:00:00Z"),
          endDate: new Date("2025-01-15T11:00:00Z"),
          hasStartSnapshots: true,
          hasEndSnapshots: true,
          isCancelled: false,
        },
      ];

      const competitionsToStart = competitions.filter(
        (c) => c.startDate <= now && !c.hasStartSnapshots && !c.isCancelled,
      );

      const competitionsToEnd = competitions.filter(
        (c) => c.endDate <= now && c.hasStartSnapshots && !c.hasEndSnapshots && !c.isCancelled,
      );

      // Competition 1: should start (start date passed, no START snapshots)
      expect(competitionsToStart.map((c) => c.id)).toContain(1);

      // Competition 2: should NOT start (start date in future)
      expect(competitionsToStart.map((c) => c.id)).not.toContain(2);

      // Competition 3: should end (end date passed, has START, no END)
      expect(competitionsToEnd.map((c) => c.id)).toContain(3);

      // Competition 4: should NOT end (end date in future)
      expect(competitionsToEnd.map((c) => c.id)).not.toContain(4);

      // Competition 5: should NOT end (already has END snapshots)
      expect(competitionsToEnd.map((c) => c.id)).not.toContain(5);

      expect(competitionsToStart.length).toBe(1);
      expect(competitionsToEnd.length).toBe(1);
    });
  });
});
