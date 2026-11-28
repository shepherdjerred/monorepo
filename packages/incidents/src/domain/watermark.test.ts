import { describe, expect, it } from "vitest";
import { isOpenStatus } from "#shared/contract.ts";
import type { IncidentRecord } from "#domain/model.ts";
import { ingestSignal, type SignalIngestDecision } from "#domain/signals.ts";
import { admitObservation, type SignalWatermark } from "#domain/watermark.ts";
import {
  actor,
  contextAt,
  minutes,
  SETTINGS,
  signal,
} from "#testing/records.ts";

const system = actor("system:main-ci");

function mark(at: number, firing: boolean, revision = 0): SignalWatermark {
  return {
    source: "main-ci",
    key: "main-ci:main",
    lastObservedAt: minutes(at),
    firing,
    revision,
  };
}

function report(at: number, firing: boolean) {
  return signal({ firing, observedAt: minutes(at).toISOString() });
}

/** A tiny persistence stand-in: applies each accepted decision like the repositories do. */
function world() {
  let watermark: SignalWatermark | null = null;
  let records: IncidentRecord[] = [];
  let nextNumber = 1;
  const decisions: SignalIngestDecision[] = [];
  return {
    send(at: number, firing: boolean): SignalIngestDecision {
      const decision = ingestSignal(
        report(at, firing),
        contextAt(minutes(at), system),
        { open: records.filter((r) => isOpenStatus(r.status)), watermark },
        SETTINGS,
      );
      decisions.push(decision);
      if (decision.kind === "ignore") return decision;
      watermark = {
        ...decision.observation,
        revision: watermark === null ? 0 : watermark.revision + 1,
      };
      if (decision.kind === "create") {
        records.push({ ...decision.transition.next, number: nextNumber });
        nextNumber += 1;
      } else if (decision.kind === "update") {
        const next = decision.transition.next;
        records = records.map((r) => (r.id === next.id ? next : r));
      }
      return decision;
    },
    records: () => records,
    watermark: () => watermark,
  };
}

describe("admitObservation", () => {
  it("accepts the first report and anything strictly newer", () => {
    expect(admitObservation(report(0, true), null)).toMatchObject({
      admitted: true,
      observation: { lastObservedAt: minutes(0), firing: true },
    });
    expect(admitObservation(report(10, true), mark(0, true)).admitted).toBe(
      true,
    );
    expect(admitObservation(report(10, false), mark(0, true)).admitted).toBe(
      true,
    );
  });

  it("rejects strictly older reports in either state", () => {
    expect(admitObservation(report(5, false), mark(10, true))).toEqual({
      admitted: false,
      reason: "out of order",
    });
    expect(admitObservation(report(5, true), mark(10, false))).toEqual({
      admitted: false,
      reason: "out of order",
    });
  });

  it("breaks equal-timestamp ties in favor of firing", () => {
    expect(admitObservation(report(5, true), mark(5, true))).toEqual({
      admitted: false,
      reason: "duplicate",
    });
    expect(admitObservation(report(5, false), mark(5, false))).toEqual({
      admitted: false,
      reason: "duplicate",
    });
    expect(admitObservation(report(5, false), mark(5, true))).toEqual({
      admitted: false,
      reason: "tie: firing wins",
    });
    expect(admitObservation(report(5, true), mark(5, false)).admitted).toBe(
      true,
    );
  });
});

describe("ingestSignal ordering", () => {
  it("ignores a retried firing after a newer clear auto-resolved its incident", () => {
    const w = world();
    expect(w.send(0, true).outcome).toBe("opened");
    expect(w.send(5, false).outcome).toBe("auto-resolved");
    expect(w.send(0, true)).toMatchObject({
      kind: "ignore",
      reason: "out of order",
    });
    expect(w.records()).toHaveLength(1);
    expect(w.records()[0]?.status).toBe("resolved");
  });

  it("remembers a clear that arrives before its delayed firing", () => {
    const w = world();
    expect(w.send(5, false)).toMatchObject({
      kind: "observe",
      reason: "nothing attached",
    });
    expect(w.watermark()).toMatchObject({
      lastObservedAt: minutes(5),
      firing: false,
    });
    expect(w.send(0, true)).toMatchObject({
      kind: "ignore",
      reason: "out of order",
    });
    expect(w.records()).toEqual([]);
  });

  it("advances on repeated firing so an older clear cannot resolve", () => {
    const w = world();
    w.send(0, true);
    const repeat = w.send(10, true);
    expect(repeat).toMatchObject({ kind: "observe", reason: "already firing" });
    expect(w.watermark()).toMatchObject({
      lastObservedAt: minutes(10),
      revision: 1,
    });
    expect(w.send(5, false)).toMatchObject({
      kind: "ignore",
      reason: "out of order",
    });
    expect(w.records()[0]).toMatchObject({ status: "investigating" });
    expect(w.records()[0]?.signals[0]).toMatchObject({
      firing: true,
      lastChangedAt: minutes(0),
    });
  });

  it("settles equal-timestamp reports to firing in either arrival order", () => {
    const fireFirst = world();
    fireFirst.send(0, true);
    expect(fireFirst.send(0, false)).toMatchObject({
      kind: "ignore",
      reason: "tie: firing wins",
    });
    expect(fireFirst.records()[0]?.status).toBe("investigating");

    const clearFirst = world();
    expect(clearFirst.send(0, false).kind).toBe("observe");
    expect(clearFirst.send(0, true).outcome).toBe("opened");
    expect(clearFirst.watermark()).toMatchObject({
      firing: true,
      lastObservedAt: minutes(0),
    });
    expect(clearFirst.send(0, true)).toMatchObject({
      kind: "ignore",
      reason: "duplicate",
    });
  });

  it("opens a new incident for a genuinely newer firing after resolution", () => {
    const w = world();
    w.send(0, true);
    w.send(5, false);
    expect(w.send(20, true).outcome).toBe("opened");
    expect(w.records().map((r) => r.status)).toEqual([
      "resolved",
      "investigating",
    ]);
  });
});
