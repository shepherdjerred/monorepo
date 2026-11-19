import { expect, test } from "vitest";
import {
  completionAfterFence,
  nextNativeCompletionWindow,
} from "./completion.ts";

const baseline = () => ({
  current: { watched: true, viewCount: 3, observedAt: 3000 },
  previous: { watched: true, viewCount: 2, observedAt: 2000, window: null },
  sameAuthority: true,
  previousSettled: true,
  now: 3001,
  maximumAgeMs: 1500,
});

test("fresh completion requires a new native counter over consecutive settled observations", () => {
  expect(nextNativeCompletionWindow(baseline())).toEqual({
    previousObservedAt: 2000,
    completedObservedAt: 3000,
  });
  expect(
    nextNativeCompletionWindow({ ...baseline(), previous: null }),
  ).toBeNull();
});

test.each([
  "binding",
  "unsettled",
  "old_unknown",
  "new_unknown",
  "decrease",
  "unwatched",
  "stale",
  "future",
] as const)(
  "invalidates completion evidence at %s without inventing a replacement",
  (change) => {
    const input = baseline();
    if (change === "binding") input.sameAuthority = false;
    if (change === "unsettled") input.previousSettled = false;
    if (change === "decrease") input.current.viewCount = 1;
    if (change === "unwatched") {
      input.current.viewCount = 0;
      input.current.watched = false;
    }
    if (change === "stale") input.now = 3001 + input.maximumAgeMs;
    if (change === "future") input.previous.observedAt = 3002;
    expect(
      nextNativeCompletionWindow({
        ...input,
        current: {
          ...input.current,
          viewCount: change === "new_unknown" ? null : input.current.viewCount,
        },
        previous: {
          ...input.previous,
          viewCount: change === "old_unknown" ? null : input.previous.viewCount,
        },
      }),
    ).toBeNull();
  },
);

test("ordinary unchanged counters keep proof while advancing the next baseline", () => {
  const window = { previousObservedAt: 1000, completedObservedAt: 1500 };
  expect(
    nextNativeCompletionWindow({
      ...baseline(),
      current: { watched: true, viewCount: 2, observedAt: 3000 },
      previous: { ...baseline().previous, window },
    }),
  ).toEqual(window);
  const firstAfterRenewal = nextNativeCompletionWindow(baseline());
  expect(completionAfterFence(firstAfterRenewal, 2500)).toBe(false);
  const next = nextNativeCompletionWindow({
    ...baseline(),
    current: { watched: true, viewCount: 4, observedAt: 4000 },
    previous: {
      watched: true,
      viewCount: 3,
      observedAt: 3000,
      window: firstAfterRenewal,
    },
    now: 4000,
  });
  expect(completionAfterFence(next, 2500)).toBe(true);
});

test("a genuine measured zero-to-one transition proves completion while missing counters remain unknown", () => {
  const input = baseline();
  expect(
    nextNativeCompletionWindow({
      ...input,
      previous: { ...input.previous, watched: false, viewCount: null },
      current: { ...input.current, viewCount: null },
    }),
  ).toBeNull();
  expect(
    nextNativeCompletionWindow({
      ...input,
      previous: { ...input.previous, watched: false, viewCount: 0 },
      current: { ...input.current, viewCount: 1 },
    }),
  ).toEqual({ previousObservedAt: 2000, completedObservedAt: 3000 });
});

test.each([
  [1999, true],
  [2000, false],
  [2001, false],
] as const)(
  "completion's previous observation must strictly follow request fence %s",
  (fence, expected) => {
    expect(
      completionAfterFence(
        { previousObservedAt: 2000, completedObservedAt: 3000 },
        fence,
      ),
    ).toBe(expected);
    expect(completionAfterFence(null, fence)).toBe(false);
  },
);
