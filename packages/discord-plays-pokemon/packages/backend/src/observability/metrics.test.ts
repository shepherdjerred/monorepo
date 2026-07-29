import { beforeEach, describe, expect, test } from "bun:test";
import { goalActive, goalDurationSeconds, goalRunsTotal } from "./metrics.ts";

beforeEach(() => {
  goalActive.reset();
  goalDurationSeconds.reset();
  goalRunsTotal.reset();
});

describe("goal metrics", () => {
  test("use only bounded process-lifecycle labels", async () => {
    goalActive.inc();
    goalActive.dec();
    goalRunsTotal.inc({ status: "completed" });
    goalDurationSeconds.observe({ status: "completed" }, 42);

    const activeMetric = await goalActive.get();
    const runMetric = await goalRunsTotal.get();
    const durationMetric = await goalDurationSeconds.get();

    expect(activeMetric.values).toEqual([
      {
        value: 0,
        labels: {},
      },
    ]);
    expect(runMetric.values).toEqual([
      {
        value: 1,
        labels: { status: "completed" },
      },
    ]);
    expect([
      ...new Set(durationMetric.values.map((value) => value.labels.status)),
    ]).toEqual(["completed"]);
  });
});
