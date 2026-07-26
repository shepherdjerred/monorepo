import { describe, expect, test } from "bun:test";
import {
  ReviewSignalEventSchema,
  formatSignalEvent,
  tallyFindings,
} from "./signal.ts";

describe("tallyFindings", () => {
  test("counts by level and maps null to unknown", () => {
    expect(tallyFindings([0, 2, 2, 3, null, null])).toEqual({
      p0: 1,
      p1: 0,
      p2: 2,
      p3: 1,
      unknown: 2,
    });
  });
});

describe("formatSignalEvent", () => {
  const event = ReviewSignalEventSchema.parse({
    schema: "review-signal/v1",
    ts: "2026-07-26T00:26:23Z",
    provider: "codex",
    pr: 1645,
    head_sha: "bd9a915208",
    head_pushed_at: "2026-07-26T00:19:58Z",
    review_state: "reviewed",
    completion_signal: "review-at-head",
    latency_s: 385,
    findings: { p0: 0, p1: 0, p2: 2, p3: 0, unknown: 0 },
    blocking_count: 2,
    unresolved_count: 2,
    gate_wait_s: 60,
    timed_out: false,
    stale_reaction: false,
    decision: "failed",
  });

  test("emits a single structured line with the component and event fields", () => {
    const parsed: unknown = JSON.parse(formatSignalEvent(event));
    expect(parsed).toMatchObject({
      component: "review-gate",
      msg: "review-signal",
      provider: "codex",
      pr: 1645,
      completion_signal: "review-at-head",
    });
  });

  test("accepts a custom component (e.g. the collector)", () => {
    const parsed: unknown = JSON.parse(
      formatSignalEvent(event, "review-signal-collector"),
    );
    expect(parsed).toMatchObject({ component: "review-signal-collector" });
  });
});
