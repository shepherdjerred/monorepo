import { describe, expect, test } from "bun:test";
import { proposeQueueWindowEdits } from "#src/model/queue-window-drift.ts";
import {
  QueueWindowsFileSchema,
  type QueueWindowsFile,
} from "#src/model/queue-windows.schema.ts";

const TODAY = "2026-07-26";
const LOOKBACK = 21;

function makeFile(
  queues: Record<string, [start: string, end: string | null][]>,
): QueueWindowsFile {
  const shaped: Record<
    string,
    { start: string; end: string | null; source: "manual" }[]
  > = {};
  for (const [queue, windows] of Object.entries(queues)) {
    shaped[queue] = windows.map(([start, end]) => ({
      start,
      end,
      source: "manual",
    }));
  }
  return QueueWindowsFileSchema.parse({ queues: shaped });
}

function propose(
  file: QueueWindowsFile,
  counts: Record<string, Record<string, number>>,
) {
  return proposeQueueWindowEdits({
    file,
    counts,
    today: TODAY,
    lookbackDays: LOOKBACK,
  });
}

describe("proposeQueueWindowEdits", () => {
  test("opens a new window for a limited queue with fresh activity", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    const { edits, next } = propose(file, {
      "1900": { "2026-07-12": 2, "2026-07-14": 2 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("open");
    expect(edits[0]?.queue).toBe("urf");
    expect(edits[0]?.date).toBe("2026-07-12");
    const urfWindows = next.queues["urf"];
    expect(urfWindows?.at(-1)).toMatchObject({
      start: "2026-07-12",
      end: null,
      source: "observed",
    });
  });

  test("does not open below the distinct-days/match thresholds", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    const { edits, warnings } = propose(file, {
      "1900": { "2026-07-12": 1, "2026-07-14": 1 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("reopens a recently-closed window when new activity is within 7 days", () => {
    const file = makeFile({ urf: [["2026-07-01", "2026-07-10"]] });
    const { edits, next } = propose(file, {
      "1900": { "2026-07-12": 2, "2026-07-14": 2 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("reopen");
    const urfWindows = next.queues["urf"];
    const last = urfWindows?.at(-1);
    expect(last?.start).toBe("2026-07-01");
    expect(last?.end).toBeNull();
    expect(last?.note).toContain("reopened by watcher 2026-07-26");
  });

  test("closes an open-ended window with a volume baseline and no recent matches", () => {
    const file = makeFile({ arena: [["2025-06-25", null]] });
    const { edits, next } = propose(file, {
      "1700": { "2026-07-06": 10, "2026-07-07": 10, "2026-07-08": 5 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("close");
    expect(edits[0]?.date).toBe("2026-07-08");
    const arenaWindows = next.queues["arena"];
    expect(arenaWindows?.at(-1)?.end).toBe("2026-07-08");
  });

  test("never auto-closes a sparse open-ended mode (no observations)", () => {
    const file = makeFile({ arena: [["2025-06-25", null]] });
    const { edits, warnings } = propose(file, {});
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("sparse-no-close");
  });

  test("warns without closing when the volume baseline is below threshold", () => {
    const file = makeFile({ arena: [["2025-06-25", null]] });
    const { edits, warnings } = propose(file, {
      "1700": { "2026-07-06": 5, "2026-07-07": 3 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("no-volume-baseline");
  });

  test("warns about unknown queue ids observed in the window", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    const { edits, warnings } = propose(file, {
      "999999": { "2026-07-10": 4 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      kind: "unknown-queue-id",
      queueId: "999999",
      total: 4,
    });
  });

  test("aggregates multiple queue ids for one mode (arena 1700 + 1750)", () => {
    const file = makeFile({ arena: [["2025-06-25", "2025-12-01"]] });
    const { edits } = propose(file, {
      "1700": { "2026-07-10": 2 },
      "1750": { "2026-07-14": 2 },
    });
    expect(edits).toHaveLength(1);
    expect(edits[0]?.kind).toBe("open");
    expect(edits[0]?.date).toBe("2026-07-10");
  });

  test("applies identical edits to the Doom Bots trio in lockstep", () => {
    const file = makeFile({
      "easy doom bots": [["2025-08-27", "2025-10-22"]],
      "normal doom bots": [["2025-08-27", "2025-10-22"]],
      "hard doom bots": [["2025-08-27", "2025-10-22"]],
    });
    const { edits, next } = propose(file, {
      "3130": { "2026-07-06": 2 },
      "4220": { "2026-07-07": 2 },
      "4250": { "2026-07-08": 1 },
    });
    expect(edits).toHaveLength(3);
    expect(edits.every((edit) => edit.kind === "open")).toBe(true);
    expect(edits.every((edit) => edit.date === "2026-07-06")).toBe(true);
    const easy = next.queues["easy doom bots"];
    const normal = next.queues["normal doom bots"];
    const hard = next.queues["hard doom bots"];
    expect(easy).toEqual(normal);
    expect(normal).toEqual(hard);
    expect(easy?.at(-1)).toMatchObject({
      start: "2026-07-06",
      end: null,
      source: "observed",
    });
  });

  test("makes no changes in steady state (live modes keep flowing)", () => {
    const file = makeFile({
      arena: [["2025-06-25", null]],
      "aram mayhem": [["2025-10-22", null]],
      urf: [["2026-06-01", "2026-06-15"]],
    });
    const { edits, warnings } = propose(file, {
      "1700": { "2026-07-22": 5 },
      "2400": { "2026-07-23": 4 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  test("ignores permanent-queue observations entirely", () => {
    const file = makeFile({ urf: [["2026-06-01", "2026-06-15"]] });
    // 420 = solo (permanent), 450 = aram (permanent) — must not appear anywhere.
    const { edits, warnings } = propose(file, {
      "420": { "2026-07-10": 50, "2026-07-11": 50 },
      "450": { "2026-07-10": 50 },
    });
    expect(edits).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
