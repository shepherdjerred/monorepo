import { beforeEach, describe, expect, test } from "vitest";
import {
  goalActive,
  goalDurationSeconds,
  goalRunsTotal,
  goalStreamDown,
  observeGoalStreamHealth,
} from "./metrics.ts";
import { streamActive } from "@shepherdjerred/discord-plays-core/observability/metrics.ts";
import { contributeGauge } from "@shepherdjerred/discord-plays-core/observability/gauge-contribution.ts";

beforeEach(() => {
  goalActive.reset();
  goalDurationSeconds.reset();
  goalRunsTotal.reset();
});

describe("goal metrics", () => {
  test("another goal or game broadcast cannot mask a goal's failed stream", async () => {
    let active = true;
    let streaming = false;
    const detachFailed = observeGoalStreamHealth({
      active: () => active,
      streaming: () => streaming,
    });
    const detachHealthy = observeGoalStreamHealth({
      active: () => true,
      streaming: () => true,
    });
    const otherGame = contributeGauge(streamActive, "sum");
    otherGame.set(1);
    try {
      expect(await goalStreamDown.get()).toHaveProperty("values", [
        { value: 1, labels: {} },
      ]);
      streaming = true;
      expect(await goalStreamDown.get()).toMatchObject({
        values: [{ value: 0 }],
      });
      streaming = false;
      active = false;
      expect(await goalStreamDown.get()).toMatchObject({
        values: [{ value: 0 }],
      });
      detachFailed();
      active = true;
      expect(await goalStreamDown.get()).toMatchObject({
        values: [{ value: 0 }],
      });
    } finally {
      detachFailed();
      detachHealthy();
      otherGame.close();
    }
  });

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
