import { describe, expect, test } from "bun:test";

import {
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  STATUS_ICONS,
  STATUS_LABELS,
  getNextStatus,
  isActiveStatus,
  isCompletedStatus,
} from "./status";
import type { TaskStatus } from "./status";

describe("STATUS_LABELS", () => {
  test("has labels for all statuses", () => {
    expect(STATUS_LABELS.open).toBe("Open");
    expect(STATUS_LABELS["in-progress"]).toBe("In Progress");
    expect(STATUS_LABELS.done).toBe("Done");
    expect(STATUS_LABELS.cancelled).toBe("Cancelled");
    expect(STATUS_LABELS.waiting).toBe("Waiting");
    expect(STATUS_LABELS.delegated).toBe("Delegated");
  });

  test("has exactly 6 entries", () => {
    expect(Object.keys(STATUS_LABELS)).toHaveLength(6);
  });
});

describe("STATUS_ICONS", () => {
  test("has icons for all statuses", () => {
    expect(STATUS_ICONS.open).toBe("circle");
    expect(STATUS_ICONS["in-progress"]).toBe("play-circle");
    expect(STATUS_ICONS.done).toBe("check-circle");
    expect(STATUS_ICONS.cancelled).toBe("x-circle");
    expect(STATUS_ICONS.waiting).toBe("clock");
    expect(STATUS_ICONS.delegated).toBe("arrow-right-circle");
  });
});

describe("ACTIVE_STATUSES", () => {
  test("contains correct active statuses", () => {
    expect(ACTIVE_STATUSES).toEqual(["open", "in-progress", "waiting", "delegated"]);
  });
});

describe("COMPLETED_STATUSES", () => {
  test("contains correct completed statuses", () => {
    expect(COMPLETED_STATUSES).toEqual(["done", "cancelled"]);
  });
});

describe("isActiveStatus", () => {
  test("returns true for open", () => {
    expect(isActiveStatus("open")).toBe(true);
  });

  test("returns true for in-progress", () => {
    expect(isActiveStatus("in-progress")).toBe(true);
  });

  test("returns true for waiting", () => {
    expect(isActiveStatus("waiting")).toBe(true);
  });

  test("returns true for delegated", () => {
    expect(isActiveStatus("delegated")).toBe(true);
  });

  test("returns false for done", () => {
    expect(isActiveStatus("done")).toBe(false);
  });

  test("returns false for cancelled", () => {
    expect(isActiveStatus("cancelled")).toBe(false);
  });
});

describe("isCompletedStatus", () => {
  test("returns true for done", () => {
    expect(isCompletedStatus("done")).toBe(true);
  });

  test("returns true for cancelled", () => {
    expect(isCompletedStatus("cancelled")).toBe(true);
  });

  test("returns false for open", () => {
    expect(isCompletedStatus("open")).toBe(false);
  });

  test("returns false for in-progress", () => {
    expect(isCompletedStatus("in-progress")).toBe(false);
  });

  test("returns false for waiting", () => {
    expect(isCompletedStatus("waiting")).toBe(false);
  });

  test("returns false for delegated", () => {
    expect(isCompletedStatus("delegated")).toBe(false);
  });
});

describe("getNextStatus", () => {
  test("open -> done", () => {
    expect(getNextStatus("open")).toBe("done");
  });

  test("in-progress -> done", () => {
    expect(getNextStatus("in-progress")).toBe("done");
  });

  test("done -> open", () => {
    expect(getNextStatus("done")).toBe("open");
  });

  test("cancelled -> open", () => {
    expect(getNextStatus("cancelled")).toBe("open");
  });

  test("waiting -> open", () => {
    expect(getNextStatus("waiting")).toBe("open");
  });

  test("delegated -> open", () => {
    expect(getNextStatus("delegated")).toBe("open");
  });

  test("toggling twice returns to completed for active statuses", () => {
    const allStatuses: TaskStatus[] = ["open", "in-progress", "done", "cancelled", "waiting", "delegated"];
    for (const status of allStatuses) {
      const next = getNextStatus(status);
      const backAgain = getNextStatus(next);
      // All should cycle between open and done
      expect(["open", "done"]).toContain(backAgain);
    }
  });
});
