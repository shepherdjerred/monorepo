import { describe, expect, test } from "vitest";
import {
  initialMaintenanceState,
  MAX_PRE_WORK_RETRIES,
  MAX_QUEUED_AGE_OUTS,
  nextMaintenanceCandidate,
  queuedMaintenanceAgeOut,
  QUEUED_AGE_OUT_MS,
  recordMaintenanceObservation,
  type CiMaintenanceKind,
  type MaintenanceCandidate,
  type MaintenanceObservation,
  type MaintenanceState,
} from "./ci-maintenance.ts";

const source = "a".repeat(40);
const bounded = { bounded: true };
const candidate = (kind: CiMaintenanceKind): MaintenanceCandidate => ({
  kind,
  source,
  fingerprint: `${kind}-v1`,
  frozen: false,
});
const at = (minutes: number) =>
  new Date(Date.UTC(2026, 10, 27, 4, 0) + minutes * 60_000).toISOString();

function submit(state: MaintenanceState, kind: CiMaintenanceKind, id: string) {
  state.pending = {
    ...candidate(kind),
    requestId: id,
    pipeline: 100,
    queuedSince: at(0),
  };
}

function observe(
  status: string,
  observedAt: string,
  startedWork = false,
): MaintenanceObservation {
  return {
    enabled: true,
    busy: false,
    candidates: [],
    observedAt,
    pending: { number: 100, status, source, startedWork },
  };
}

describe("bounded pre-work retries", () => {
  test("retry a transient pre-work error, then block after the bound", () => {
    const state = initialMaintenanceState();
    for (let attempt = 1; attempt <= MAX_PRE_WORK_RETRIES; attempt++) {
      submit(state, "workspace-golden", `request-${attempt.toString()}`);
      recordMaintenanceObservation(
        state,
        observe("error", at(attempt)),
        bounded,
      );
      expect(state.pending).toBeNull();
      expect(state.blocked).toEqual({});
      expect(state.preWorkRetries).toEqual({ "workspace-golden": attempt });
      expect(state.observation).toBe(
        `Pipeline 100 ended error before starting work; retry ${attempt.toString()} of 6 next tick`,
      );
    }
    submit(state, "workspace-golden", "request-final");
    recordMaintenanceObservation(state, observe("error", at(99)), bounded);
    expect(state.blocked["workspace-golden"]).toEqual({
      requestId: "request-final",
      reason:
        "Pipeline 100 ended error before starting work after 6 automatic retries; inspect before retrying",
      blockedAt: at(99),
    });
    expect(state.preWorkRetries).toEqual({});
  });

  test("a success resets the count and the legacy policy never blocks", () => {
    const state = initialMaintenanceState();
    submit(state, "ci-images", "request-1");
    recordMaintenanceObservation(state, observe("error", at(1)), bounded);
    expect(state.preWorkRetries).toEqual({ "ci-images": 1 });
    submit(state, "ci-images", "request-2");
    recordMaintenanceObservation(state, observe("success", at(2)), bounded);
    expect(state.preWorkRetries).toEqual({});
    expect(state.completed["ci-images"]).toBe("ci-images-v1");

    const legacy = initialMaintenanceState();
    for (let attempt = 0; attempt < 20; attempt++) {
      submit(legacy, "ci-images", `legacy-${attempt.toString()}`);
      recordMaintenanceObservation(legacy, observe("error", at(attempt)));
    }
    expect(legacy.blocked).toEqual({});
    expect(legacy.preWorkRetries).toBeUndefined();
  });

  test("a started-work failure still blocks immediately", () => {
    const state = initialMaintenanceState();
    submit(state, "ci-images", "request-1");
    recordMaintenanceObservation(state, observe("error", at(1)), bounded);
    submit(state, "ci-images", "request-2");
    recordMaintenanceObservation(
      state,
      observe("failure", at(2), true),
      bounded,
    );
    expect(state.blocked["ci-images"]?.reason).toBe(
      "Pipeline 100 ended failure; inspect before retrying",
    );
    expect(state.preWorkRetries).toEqual({});
  });
});

describe("queued age-out", () => {
  test("starts the clock for a request an earlier coordinator submitted", () => {
    const state = initialMaintenanceState();
    state.pending = { ...candidate("ci-images"), requestId: "r", pipeline: 7 };
    const queued = { ...observe("pending", at(0)), pending: null };
    recordMaintenanceObservation(state, queued);
    expect(state.pending.queuedSince).toBeUndefined();
    recordMaintenanceObservation(
      state,
      {
        ...queued,
        pending: { number: 7, status: "pending", source, startedWork: false },
      },
      bounded,
    );
    expect(state.pending.queuedSince).toBe(at(0));
    recordMaintenanceObservation(
      state,
      {
        ...queued,
        observedAt: at(5),
        pending: { number: 7, status: "pending", source, startedWork: false },
      },
      bounded,
    );
    expect(state.pending.queuedSince).toBe(at(0));
  });

  test("ages out only a request queued past the bound, once", () => {
    const state = initialMaintenanceState();
    submit(state, "ci-images", "request-1");
    const bound = QUEUED_AGE_OUT_MS / 60_000;
    expect(
      queuedMaintenanceAgeOut(state, observe("pending", at(bound - 1))),
    ).toBeUndefined();
    expect(
      queuedMaintenanceAgeOut(state, observe("running", at(bound + 1))),
    ).toBeUndefined();
    expect(
      queuedMaintenanceAgeOut(state, observe("pending", at(bound + 1), true)),
    ).toBeUndefined();
    const due = queuedMaintenanceAgeOut(state, observe("pending", at(bound)));
    expect(due?.requestId).toBe("request-1");
    if (state.pending === null) throw new Error("Missing pending request");
    state.pending.cancelRequestedAt = at(bound);
    expect(
      queuedMaintenanceAgeOut(state, observe("pending", at(bound + 30))),
    ).toBeUndefined();
  });

  test("a stuck age-out settles without counting as a retry", () => {
    const state = initialMaintenanceState();
    submit(state, "ci-images", "request-1");
    if (state.pending === null) throw new Error("Missing pending request");
    state.pending.cancelRequestedAt = at(120);
    recordMaintenanceObservation(state, observe("killed", at(125)), bounded);
    expect(state.pending).toBeNull();
    expect(state.lastKind).toBe("ci-images");
    expect(state.blocked).toEqual({});
    expect(state.preWorkRetries).toBeUndefined();
    expect(state.ageOuts).toEqual({ "ci-images": 1 });
    expect(state.observation).toBe(
      "Aged out pipeline 100 after it got stuck in the queue (1 of 3); rotating to the next stream",
    );
  });

  test("a stream stuck three times in a row blocks with a clear reason", () => {
    const state = initialMaintenanceState();
    for (let round = 1; round <= MAX_QUEUED_AGE_OUTS; round++) {
      submit(state, "workspace-golden", `request-${round.toString()}`);
      if (state.pending === null) throw new Error("Missing pending request");
      state.pending.cancelRequestedAt = at(round * 130);
      recordMaintenanceObservation(
        state,
        observe("killed", at(round * 130 + 5)),
        bounded,
      );
    }
    expect(state.blocked["workspace-golden"]).toEqual({
      requestId: "request-3",
      reason:
        "Pipeline 100 was aged out of the queue 3 times in a row with evidence it could not run; check its agent pool and labels before retrying",
      blockedAt: at(395),
    });
    expect(state.ageOuts).toEqual({});
  });

  test("a request an agent takes resets its stream's age-outs and records startedAt", () => {
    const state = initialMaintenanceState();
    state.ageOuts = { "workspace-golden": 2, "ci-images": 1 };
    submit(state, "workspace-golden", "request-1");
    recordMaintenanceObservation(state, observe("pending", at(5)), bounded);
    expect(state.pending?.startedAt).toBeUndefined();
    expect(state.ageOuts).toEqual({ "workspace-golden": 2, "ci-images": 1 });
    recordMaintenanceObservation(state, observe("running", at(10)), bounded);
    expect(state.pending?.startedAt).toBe(at(10));
    expect(state.ageOuts).toEqual({ "ci-images": 1 });
    recordMaintenanceObservation(state, observe("running", at(15)), bounded);
    expect(state.pending?.startedAt).toBe(at(10));
  });
});

describe("inspection heartbeat", () => {
  test("only a bounded coordinator records each successful inspection, pending or not", () => {
    const state = initialMaintenanceState();
    recordMaintenanceObservation(state, observe("pending", at(5)));
    expect(state.inspectedAt).toBeUndefined();
    recordMaintenanceObservation(state, observe("pending", at(5)), bounded);
    expect(state.inspectedAt).toBe(at(5));
    submit(state, "ci-images", "request-1");
    recordMaintenanceObservation(state, observe("pending", at(10)), bounded);
    expect(state.inspectedAt).toBe(at(10));
  });
});

describe("stream rotation", () => {
  const all = [
    candidate("release-notes"),
    candidate("ci-images"),
    candidate("workspace-seeds"),
    candidate("workspace-golden"),
  ];

  test("bounded selection visits every stream before repeating one", () => {
    const state = initialMaintenanceState();
    const picked: CiMaintenanceKind[] = [];
    for (let turn = 0; turn < 8; turn++) {
      const next = nextMaintenanceCandidate(state, all, bounded);
      if (next === undefined) throw new Error("No candidate");
      picked.push(next.kind);
      state.lastKind = next.kind;
    }
    expect(picked).toEqual([
      "workspace-seeds",
      "workspace-golden",
      "release-notes",
      "ci-images",
      "workspace-seeds",
      "workspace-golden",
      "release-notes",
      "ci-images",
    ]);
  });

  test("the legacy order only defers the last stream, which can starve a third", () => {
    const state = initialMaintenanceState();
    const picked: CiMaintenanceKind[] = [];
    for (let turn = 0; turn < 4; turn++) {
      const next = nextMaintenanceCandidate(state, all);
      if (next === undefined) throw new Error("No candidate");
      picked.push(next.kind);
      state.lastKind = next.kind;
    }
    expect(picked).toEqual([
      "release-notes",
      "ci-images",
      "release-notes",
      "ci-images",
    ]);
  });
});
