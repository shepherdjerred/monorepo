import { describe, expect, it } from "vitest";
import { bucketBySeverity } from "./severity-buckets.ts";

const RANK: Record<string, number> = { ok: 0, warning: 1, error: 2 };

describe("bucketBySeverity", () => {
  it("puts the worst severity first and keeps item order within a bucket", () => {
    const items = [
      { id: "a", sev: "warning" },
      { id: "b", sev: "error" },
      { id: "c", sev: "warning" },
      { id: "d", sev: "ok" },
    ];
    const buckets = bucketBySeverity(
      items,
      (item) => item.sev,
      (sev) => RANK[sev] ?? -1,
    );
    expect(
      buckets.map(([sev, bucket]) => [sev, bucket.map((item) => item.id)]),
    ).toEqual([
      ["error", ["b"]],
      ["warning", ["a", "c"]],
      ["ok", ["d"]],
    ]);
  });

  it("returns no buckets for no items", () => {
    expect(
      bucketBySeverity(
        [],
        (item: string) => item,
        () => 0,
      ),
    ).toEqual([]);
  });
});
