import { describe, expect, it } from "bun:test";
import { BUCKET_WIDTH, clusterFindings, clusterKey } from "./cluster-key.ts";

describe("clusterKey", () => {
  it("buckets line numbers on multiples of BUCKET_WIDTH", () => {
    expect(clusterKey("a.ts", 0)).toBe("a.ts|0");
    expect(clusterKey("a.ts", 6)).toBe("a.ts|0");
    expect(clusterKey("a.ts", 7)).toBe("a.ts|7");
    expect(clusterKey("a.ts", 10)).toBe("a.ts|7");
    expect(clusterKey("a.ts", 13)).toBe("a.ts|7");
    expect(clusterKey("a.ts", 14)).toBe("a.ts|14");
  });

  it("uses the file path as part of the key so identical lines on different files do not cluster", () => {
    expect(clusterKey("a.ts", 10)).not.toBe(clusterKey("b.ts", 10));
  });

  it("keeps large line numbers stable", () => {
    expect(clusterKey("x.ts", 700)).toBe("x.ts|700");
    expect(clusterKey("x.ts", 706)).toBe("x.ts|700");
    expect(clusterKey("x.ts", 707)).toBe("x.ts|707");
  });

  it("documents the boundary caveat: lines 6 and 7 land in different buckets", () => {
    expect(clusterKey("a.ts", 6)).not.toBe(clusterKey("a.ts", 7));
  });

  it("uses the documented bucket width", () => {
    expect(BUCKET_WIDTH).toBe(7);
  });
});

describe("clusterFindings", () => {
  it("groups findings sharing a cluster key", () => {
    const result = clusterFindings([
      { file: "a.ts", lineStart: 10 },
      { file: "a.ts", lineStart: 12 },
      { file: "a.ts", lineStart: 13 },
      { file: "a.ts", lineStart: 14 },
      { file: "b.ts", lineStart: 12 },
    ]);
    expect([...result.keys()].toSorted()).toEqual([
      "a.ts|14",
      "a.ts|7",
      "b.ts|7",
    ]);
    expect(result.get("a.ts|7")).toHaveLength(3);
    expect(result.get("a.ts|14")).toHaveLength(1);
    expect(result.get("b.ts|7")).toHaveLength(1);
  });

  it("returns an empty map for an empty input", () => {
    expect(clusterFindings([])).toEqual(new Map());
  });

  it("preserves insertion order within a cluster", () => {
    const findings = [
      { file: "a.ts", lineStart: 8, tag: "first" as const },
      { file: "a.ts", lineStart: 9, tag: "second" as const },
      { file: "a.ts", lineStart: 10, tag: "third" as const },
    ];
    const cluster = clusterFindings(findings).get("a.ts|7");
    expect(cluster?.map((f) => f.tag)).toEqual(["first", "second", "third"]);
  });

  it("accepts extra fields via the generic constraint", () => {
    // Compile-time check that arbitrary extra fields are preserved.
    type Rich = { file: string; lineStart: number; severity: "warning" };
    const findings: Rich[] = [
      { file: "a.ts", lineStart: 10, severity: "warning" },
    ];
    const cluster = clusterFindings(findings).get("a.ts|7");
    expect(cluster?.[0]?.severity).toBe("warning");
  });
});
