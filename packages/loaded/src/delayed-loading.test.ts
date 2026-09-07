import { describe, expect, test } from "vitest";
import {
  LOADING_INDICATOR_DELAY_MS,
  LOADING_INDICATOR_MIN_DURATION_MS,
  scheduleDelayedLoading,
} from "@shepherdjerred/loaded/delayed-loading.ts";

const defaults = {
  delayMs: LOADING_INDICATOR_DELAY_MS,
  minDurationMs: LOADING_INDICATOR_MIN_DURATION_MS,
};

describe("scheduleDelayedLoading", () => {
  test("does not show an indicator until the delay elapses", () => {
    expect(
      scheduleDelayedLoading({
        busy: true,
        visible: false,
        visibleSince: null,
        now: 0,
        ...defaults,
      }),
    ).toEqual({ visible: false, waitMs: LOADING_INDICATOR_DELAY_MS });
  });

  test("stays hidden when busy ends before the delay", () => {
    expect(
      scheduleDelayedLoading({
        busy: false,
        visible: false,
        visibleSince: null,
        now: 50,
        ...defaults,
      }),
    ).toEqual({ visible: false, waitMs: null });
  });

  test("keeps a shown indicator up for the minimum duration", () => {
    expect(
      scheduleDelayedLoading({
        busy: false,
        visible: true,
        visibleSince: 300,
        now: 310,
        ...defaults,
      }),
    ).toEqual({ visible: true, waitMs: 190 });
  });

  test("hides immediately once the minimum duration has elapsed", () => {
    expect(
      scheduleDelayedLoading({
        busy: false,
        visible: true,
        visibleSince: 300,
        now: 500,
        ...defaults,
      }),
    ).toEqual({ visible: false, waitMs: null });
  });

  test("shows immediately when delay is zero", () => {
    expect(
      scheduleDelayedLoading({
        busy: true,
        visible: false,
        visibleSince: null,
        now: 0,
        delayMs: 0,
        minDurationMs: 0,
      }),
    ).toEqual({ visible: true, waitMs: null });
  });
});
