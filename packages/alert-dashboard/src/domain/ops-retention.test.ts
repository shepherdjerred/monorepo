import { describe, expect, it } from "vitest";

import { prunableSnapshotIds } from "#domain/ops-retention";

const HOUR = 3_600_000_000_000n;
const MINUTE = 60_000_000_000n;
const base = 1_790_000_000n * 1_000_000_000n;
const baseHour = (base / HOUR) * HOUR;

function row(id: string, generatedAtNs: bigint) {
  return { id, generatedAtNs };
}

describe("snapshot retention", () => {
  it("keeps the earliest sample per hour plus the latest snapshot", () => {
    const rows = [
      row("h0-a", baseHour + 1n * MINUTE),
      row("h0-b", baseHour + 6n * MINUTE),
      row("h0-c", baseHour + 11n * MINUTE),
      row("h1-a", baseHour + HOUR + 2n * MINUTE),
      row("h1-b", baseHour + HOUR + 7n * MINUTE),
    ];
    expect(
      prunableSnapshotIds(rows, baseHour + 2n * HOUR, 90).toSorted(),
    ).toEqual(["h0-b", "h0-c"]);
  });

  it("drops samples older than the retention window but never the latest", () => {
    const old = baseHour - 91n * 24n * HOUR;
    expect(prunableSnapshotIds([row("old", old)], baseHour, 90)).toEqual([]);
    expect(
      prunableSnapshotIds(
        [row("old", old), row("new", baseHour)],
        baseHour,
        90,
      ),
    ).toEqual(["old"]);
  });

  it("converges to one row per hour as ingests continue", () => {
    let rows: { id: string; generatedAtNs: bigint }[] = [];
    for (let index = 0; index < 36; index += 1) {
      const generatedAtNs = baseHour + BigInt(index) * 5n * MINUTE;
      rows.push(row(`s${String(index)}`, generatedAtNs));
      const prune = new Set(prunableSnapshotIds(rows, generatedAtNs, 90));
      rows = rows.filter((entry) => !prune.has(entry.id));
    }
    // 36 five-minute samples span three hours: three hourly samples plus
    // the latest.
    expect(rows.map((entry) => entry.id)).toEqual(["s0", "s12", "s24", "s35"]);
  });
});
