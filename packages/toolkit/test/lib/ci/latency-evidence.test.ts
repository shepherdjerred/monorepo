import { afterEach, expect, test, vi } from "vitest";
import {
  emptyFindingCounts,
  type ReviewSignalEvent,
} from "@shepherdjerred/code-review";
import { reviewEvidence } from "#lib/ci/review-evidence.ts";
import {
  latencyEvidence,
  stepEvidence,
  type LatencyEvidence,
} from "#lib/ci/latency-evidence.ts";
import { boundedLogs, decodeLogs } from "#lib/ci/native-logs.ts";
import { latencyReport } from "#lib/ci/latency.ts";
import type { WoodpeckerPipeline } from "#lib/woodpecker/ci.ts";

const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "private-test-token",
  repoId: 1,
};
const head = "a".repeat(40);
const pipeline: WoodpeckerPipeline = {
  number: 1,
  commit: head,
  status: "success",
  created: 100,
  finished: 300,
  event: "pull_request",
  ref: "refs/pull/7/head",
  workflows: ["verify", "codex-review-gate", "ci-complete"].map((name, i) => ({
    name,
    state: "success",
    started: 110,
    finished: 300,
    children: [{ id: i + 1, pid: i + 1, name, state: "success", exit_code: 0 }],
  })),
};
const signal = (extra: Partial<ReviewSignalEvent> = {}): ReviewSignalEvent => ({
  schema: "review-signal/v1",
  ts: new Date(250_000).toISOString(),
  provider: "codex",
  pr: 7,
  head_sha: head,
  head_pushed_at: new Date(90_000).toISOString(),
  review_state: "reviewed",
  completion_signal: "review-at-head",
  reviewed_at_head: true,
  latency_s: 30,
  findings: emptyFindingCounts(),
  blocking_count: 0,
  unresolved_count: 0,
  gate_wait_s: 150,
  timed_out: false,
  stale_reaction: false,
  blocked_reason: null,
  decision: "passed",
  request_attempts: 1,
  parser_commit: head,
  ...extra,
});
const header =
  "Review gate: providers=codex,coderabbit, repo=shepherdjerred/monorepo, pr=#7";
const lines = (events: ReviewSignalEvent[]) => [
  header,
  ...events.map((event) => JSON.stringify(event)),
];
const quota = (provider: string) =>
  signal({
    provider,
    review_state: "errored",
    blocked_reason: "usage-limited",
    reviewed_at_head: false,
    latency_s: null,
    decision: "failed",
  });
const encoded = (texts: string[]) =>
  texts.map((data, line) => ({
    data: Buffer.from(data).toString("base64"),
    line,
    type: 0,
  }));
afterEach(() => vi.unstubAllGlobals());

test("fresh, reused, mixed and quota coverage follow final exact-head observations", () => {
  const fresh = signal();
  const reused = signal({ provider: "coderabbit", latency_s: 5 });
  expect(
    reviewEvidence(lines([fresh, quota("coderabbit")]), pipeline),
  ).toMatchObject({
    kind: "fresh",
    providers: [{ kind: "fresh" }, { kind: "quota-exempt" }],
  });
  expect(reviewEvidence(lines([fresh, reused]), pipeline).kind).toBe("mixed");
  expect(reviewEvidence(lines([quota("codex"), reused]), pipeline).kind).toBe(
    "reused",
  );
  expect(
    reviewEvidence(lines([quota("codex"), quota("coderabbit")]), pipeline).kind,
  ).toBe("quota-exempt");
  expect(
    reviewEvidence(
      lines([fresh, quota("coderabbit"), quota("codex")]),
      pipeline,
    ).kind,
  ).toBe("quota-exempt");
});

test.each([
  { head_sha: "b".repeat(40) },
  { reviewed_at_head: false },
  { head_pushed_at: null },
  { head_pushed_at: "invalid" },
  { latency_s: -5 },
  { latency_s: 10 },
  { latency_s: 1000 },
  { decision: "waiting" },
  { ts: "invalid" },
  { ts: new Date(80_000).toISOString() },
  { ts: new Date(400_000).toISOString() },
] satisfies Partial<ReviewSignalEvent>[])(
  "uncertain or invalid completion is unknown: %j",
  (extra) => {
    expect(
      reviewEvidence(lines([signal(extra), quota("coderabbit")]), pipeline)
        .kind,
    ).toBe("unknown");
  },
);

test("an unfinished OR-gate provider preserves a proven fresh completion", () => {
  for (const events of [
    [signal()],
    [
      signal(),
      signal({
        provider: "coderabbit",
        decision: "waiting",
        reviewed_at_head: false,
        latency_s: null,
      }),
    ],
  ]) {
    const review = reviewEvidence(lines(events), pipeline);
    expect(review).toMatchObject({
      kind: "fresh",
      providers: [
        { provider: "codex", kind: "fresh" },
        { provider: "coderabbit", kind: "unknown" },
      ],
    });
    expect(
      latencyReport([pipeline], 0, 500, new Map([[1, { review, steps: [] }]]))
        .freshReadyHeads.count,
    ).toBe(1);
  }
  expect(reviewEvidence(lines([quota("codex")]), pipeline).kind).toBe(
    "unknown",
  );
});

test("missing header and later gate restarts cannot look fresh", () => {
  expect(reviewEvidence([JSON.stringify(signal())], pipeline).kind).toBe(
    "unknown",
  );
  expect(
    reviewEvidence(
      [...lines([signal(), quota("coderabbit")]), header],
      pipeline,
    ).kind,
  ).toBe("unknown");
});

test("structured checkout and toolchain measurements retain units and validate identity", () => {
  const checkout = {
    schemaVersion: 1,
    sourceSha: head,
    cache: "hit",
    downloadedObjectBytes: 0,
    downloadMs: 0,
    materializationMs: 4000,
    totalMs: 20_000,
  };
  const bootstrap = {
    schemaVersion: 1,
    sourceSha: head,
    scope: "automation",
    elapsedSeconds: 2,
  };
  const evidence = stepEvidence(
    [
      `CI_CHECKOUT_DIAGNOSTIC ${JSON.stringify(checkout)}`,
      `CI_BOOTSTRAP_DIAGNOSTIC ${JSON.stringify(bootstrap)}`,
      config.token,
    ],
    pipeline,
  );
  expect(evidence).toEqual({ checkout, bootstrap: [bootstrap] });
  expect(JSON.stringify(evidence)).not.toContain(config.token);
  expect(() =>
    stepEvidence(
      [
        `CI_CHECKOUT_DIAGNOSTIC ${JSON.stringify({ ...checkout, sourceSha: "b".repeat(40) })}`,
      ],
      pipeline,
    ),
  ).toThrow("identity");
  expect(() =>
    stepEvidence(
      Array.from(
        { length: 2 },
        () => `CI_CHECKOUT_DIAGNOSTIC ${JSON.stringify(checkout)}`,
      ),
      pipeline,
    ),
  ).toThrow("uniqueness");
});

test("native log decoding validates base64, sorts entries and preserves lines", () => {
  expect(decodeLogs(encoded(["one\ntwo", "three"]).toReversed())).toEqual([
    "one",
    "two",
    "three",
  ]);
  expect(() =>
    decodeLogs([{ data: "!not-base64!", type: 0, line: 1 }]),
  ).toThrow("base64");
});

test("history evidence limits concurrent reads and omits raw logs", async () => {
  let active = 0;
  let maximum = 0;
  const fetchMock = vi.fn(async () => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    return Response.json(
      encoded([...lines([signal(), quota("coderabbit")]), config.token]),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  const evidence = await latencyEvidence(
    Array.from({ length: 8 }, (_, i) => ({ ...pipeline, number: i + 1 })),
    config,
  );
  expect(maximum).toBe(4);
  expect(fetchMock).toHaveBeenCalledTimes(16);
  expect(evidence.get(1)?.review.kind).toBe("fresh");
  expect(JSON.stringify([...evidence])).not.toContain(config.token);
});

test("unavailable and malformed evidence remains unknown while aborts propagate", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(config.token, { status: 404 })),
  );
  const records = await latencyEvidence([pipeline], config);
  expect(records.get(1)?.steps.every((step) => !step.available)).toBe(true);
  expect(records.get(1)?.review.kind).toBe("unknown");
  expect(JSON.stringify([...records])).not.toContain(config.token);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(encoded(['{"schema":"review-signal/v1"}'])),
    ),
  );
  const malformed = await latencyEvidence([pipeline], config);
  expect(malformed.get(1)?.review.kind).toBe("unknown");
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("aborted");
    }),
  );
  await expect(
    latencyEvidence([pipeline], config, controller.signal),
  ).rejects.toThrow("aborted");
});

test("malformed measurements preserve valid review evidence", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        encoded([
          "CI_BOOTSTRAP_DIAGNOSTIC malformed",
          ...lines([signal(), quota("coderabbit")]),
        ]),
      ),
    ),
  );
  const records = await latencyEvidence([pipeline], config);
  const record = records.get(1);
  expect(record?.review.kind).toBe("fresh");
  expect(record?.steps.every((step) => !step.available)).toBe(true);
});

test("malformed review evidence preserves valid measurements", async () => {
  const bootstrap = {
    schemaVersion: 1,
    sourceSha: head,
    scope: "automation",
    elapsedSeconds: 2,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        encoded([
          `CI_BOOTSTRAP_DIAGNOSTIC ${JSON.stringify(bootstrap)}`,
          '{"schema":"review-signal/v1"}',
        ]),
      ),
    ),
  );
  const records = await latencyEvidence([pipeline], config);
  const record = records.get(1);
  expect(record?.review.kind).toBe("unknown");
  expect(record?.steps.every((step) => step.available)).toBe(true);
  expect(
    record?.steps.find((step) => step.workflow.includes("review")),
  ).toMatchObject({ bootstrap: [bootstrap] });
});

test("successful log reads release the lock without cancelling the stream", async () => {
  const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(JSON.stringify(encoded(["ok"]))),
      );
      controller.close();
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body)),
  );
  await expect(boundedLogs("/logs", config)).resolves.toEqual(["ok"]);
  expect(cancel).not.toHaveBeenCalled();
  expect(body.locked).toBe(false);
});

test("failed cancellation preserves the original failure and releases the lock", async () => {
  const cancel = vi.fn(() => Promise.reject(new Error("cancel failed")));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body)),
  );
  await expect(boundedLogs("/logs", config)).rejects.toThrow("exceeds limit");
  expect(cancel).toHaveBeenCalledOnce();
  expect(body.locked).toBe(false);
});

test("oversized log responses stop at the byte limit", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x".repeat(8 * 1024 * 1024 + 1))),
  );
  await expect(boundedLogs("/logs", config)).rejects.toThrow("exceeds limit");
});

test("fresh SLO samples deduplicate heads and exclude reruns and quota-only gates", () => {
  const fresh: LatencyEvidence = {
    review: { kind: "fresh", providers: [] },
    steps: [],
  };
  const quotaOnly: LatencyEvidence = {
    review: { kind: "quota-exempt", providers: [] },
    steps: [],
  };
  const report = latencyReport(
    [
      pipeline,
      { ...pipeline, number: 2, finished: 400 },
      { ...pipeline, number: 3, commit: "b".repeat(40), rerun_count: 1 },
      { ...pipeline, number: 4, commit: "c".repeat(40) },
    ],
    0,
    500,
    new Map([
      [1, fresh],
      [2, fresh],
      [3, fresh],
      [4, quotaOnly],
    ]),
  );
  expect(report.freshReadyHeads).toEqual({
    requiredSamples: 30,
    enoughSamples: false,
    count: 1,
    missing: 0,
    p50Seconds: 300,
    p95Seconds: 300,
  });
  expect(report.cohorts).toHaveLength(3);
});

test("mixed gates contribute fresh heads without losing cohort or deduplication", () => {
  const fresh: LatencyEvidence = {
    review: reviewEvidence(lines([signal(), quota("coderabbit")]), pipeline),
    steps: [],
  };
  const mixed: LatencyEvidence = {
    review: reviewEvidence(
      lines([signal(), signal({ provider: "coderabbit", latency_s: 5 })]),
      pipeline,
    ),
    steps: [],
  };
  const report = latencyReport(
    [
      pipeline,
      { ...pipeline, number: 2, finished: 450 },
      { ...pipeline, number: 3, commit: "b".repeat(40), finished: 420 },
      { ...pipeline, number: 4, commit: "c".repeat(40) },
      { ...pipeline, number: 5, commit: "d".repeat(40), rerun_count: 1 },
      { ...pipeline, number: 6, commit: "e".repeat(40), status: "failure" },
    ],
    0,
    500,
    new Map([
      [1, fresh],
      [2, mixed],
      [3, mixed],
      [4, { review: { kind: "reused", providers: [] }, steps: [] }],
      [5, mixed],
      [6, mixed],
    ]),
  );
  expect(report.freshReadyHeads).toEqual({
    requiredSamples: 30,
    enoughSamples: false,
    count: 2,
    missing: 0,
    p50Seconds: 320,
    p95Seconds: 350,
  });
  expect(report.cohorts).toHaveLength(5);
  expect(report.records[1]).toMatchObject({
    review: "mixed",
    reviewProviders: [{ kind: "fresh" }, { kind: "reused" }],
  });
});
