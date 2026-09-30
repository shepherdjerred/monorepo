import { describe, expect, test } from "vitest";
import {
  applyFreshness,
  assembleSnapshot,
  findSection,
  needsMeSignals,
  newSignals,
  requireMetric,
  SECTION_DEFINITIONS,
} from "@shepherdjerred/ops-model/assemble.ts";
import {
  SOURCE_IDS,
  type SourceStatus,
} from "@shepherdjerred/ops-model/snapshot.ts";

const generatedAt = new Date("2026-09-24T12:00:00.000Z");

function sources(failed: readonly string[] = []): SourceStatus[] {
  return SOURCE_IDS.map((source) => ({
    source,
    ok: !failed.includes(source),
    observedAt: generatedAt.toISOString(),
    durationMs: 10,
    ...(failed.includes(source) ? { error: "timeout" } : {}),
  }));
}

describe("assembleSnapshot", () => {
  test("every section covers only known sources and every source has a section", () => {
    const covered = new Set(SECTION_DEFINITIONS.flatMap((d) => d.sources));
    expect([...covered].toSorted()).toEqual([...SOURCE_IDS].toSorted());
  });

  test("a healthy snapshot is ok with an all-clear summary", () => {
    const snapshot = assembleSnapshot({
      generatedAt,
      sources: sources(),
      signals: [],
      metrics: [],
    });
    expect(snapshot.severity).toBe("ok");
    expect(snapshot.summary).toBe("All systems healthy");
    expect(snapshot.sections.map((s) => s.id)).toEqual(
      SECTION_DEFINITIONS.map((d) => d.id),
    );
  });

  test("a failed source makes its section unknown, never green", () => {
    const snapshot = assembleSnapshot({
      generatedAt,
      sources: sources(["linear"]),
      signals: [],
      metrics: [],
    });
    const work = findSection(snapshot, "work");
    expect(work.severity).toBe("unknown");
    expect(work.summary).toContain("no data from linear");
    expect(snapshot.severity).toBe("unknown");
  });

  test("a source missing from the report is treated as failed", () => {
    const snapshot = assembleSnapshot({
      generatedAt,
      sources: sources().filter((status) => status.source !== "bugsink"),
      signals: [],
      metrics: [],
    });
    expect(findSection(snapshot, "errors").severity).toBe("unknown");
  });

  test("signals roll up worst-first and needsMe is counted", () => {
    const snapshot = assembleSnapshot({
      generatedAt,
      sources: sources(),
      signals: [
        {
          id: "renovate:approve:foo",
          source: "renovate",
          section: "delivery",
          kind: "renovate-approval",
          severity: "info",
          needsMe: true,
          title: "Approve foo",
        },
        {
          id: "ci:main",
          source: "ci",
          section: "delivery",
          kind: "ci-pipeline",
          severity: "error",
          needsMe: false,
          title: "main is failing",
          since: "2026-09-24T11:00:00.000Z",
        },
      ],
      metrics: [
        {
          section: "delivery",
          id: "github.prs.open",
          label: "Open PRs",
          value: 4,
          unit: "count",
          severity: "ok",
          source: "github",
        },
      ],
    });
    const delivery = findSection(snapshot, "delivery");
    expect(delivery.severity).toBe("error");
    expect(delivery.signals.map((s) => s.id)).toEqual([
      "ci:main",
      "renovate:approve:foo",
    ]);
    expect(delivery.summary).toBe("1 issue · 1 waiting on you");
    expect(requireMetric(delivery, "github.prs.open").value).toBe(4);
    expect(() => requireMetric(delivery, "missing")).toThrow(/no metric/);
    expect(needsMeSignals(snapshot).map((s) => s.id)).toEqual([
      "renovate:approve:foo",
    ]);
    expect(newSignals(snapshot, new Set(["ci:main"])).map((s) => s.id)).toEqual(
      ["renovate:approve:foo"],
    );
    expect(snapshot.summary).toContain("Delivery");
  });

  test("rejects a signal that breaks the contract", () => {
    expect(() =>
      assembleSnapshot({
        generatedAt,
        sources: sources(),
        signals: [
          {
            id: "",
            source: "ci",
            section: "delivery",
            kind: "x",
            severity: "ok",
            needsMe: false,
            title: "t",
          },
        ],
        metrics: [],
      }),
    ).toThrow();
  });
});

describe("applyFreshness", () => {
  const snapshot = assembleSnapshot({
    generatedAt,
    sources: sources(),
    signals: [],
    metrics: [],
  });

  test("a fresh snapshot keeps its severity", () => {
    const fresh = applyFreshness(
      snapshot,
      new Date("2026-09-24T12:05:00.000Z"),
    );
    expect(fresh.stale).toBe(false);
    expect(fresh.severity).toBe("ok");
  });

  test("a stale snapshot degrades healthy sections to unknown", () => {
    const stale = applyFreshness(
      snapshot,
      new Date("2026-09-24T12:30:00.000Z"),
    );
    expect(stale.stale).toBe(true);
    expect(stale.severity).toBe("unknown");
    expect(stale.sections.every((s) => s.severity === "unknown")).toBe(true);
    expect(stale.summary).toMatch(/^Snapshot is 30 minutes old/);
  });
});
