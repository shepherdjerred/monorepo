import { expect, test } from "vitest";
import {
  automaticallyExpired,
  resumesExpiredInterest,
} from "./playback-renewal.ts";

const claim = {
  active: true,
  direct: true,
  excluded: false,
  keepingPolicy: "temporary" as const,
  interestState: "expired" as const,
  interestReleaseReason: "lost_interest",
  interestReleasedAt: new Date(2000),
  interestRenewedAt: new Date(1000),
  lastMeaningfulProgressAt: new Date(1500),
};

test("only unconsumed progress strictly after automatic expiry renews", () => {
  expect(resumesExpiredInterest(claim, 2001)).toBe(true);
  for (const progress of [null, 1000, 1500, 1999, 2000])
    expect(resumesExpiredInterest(claim, progress)).toBe(false);
  expect(
    resumesExpiredInterest(
      { ...claim, lastMeaningfulProgressAt: new Date(3000) },
      3000,
    ),
  ).toBe(false);
  expect(
    resumesExpiredInterest(
      { ...claim, interestRenewedAt: new Date(3000) },
      3000,
    ),
  ).toBe(false);
});

test("manual releases, Keep and withdrawn or inherited claims cannot revive", () => {
  for (const patch of [
    { interestState: "finished" as const },
    { interestState: "dropped" as const },
    { interestReleaseReason: "manual" },
    { interestReleasedAt: null },
    { active: false },
    { direct: false },
    { excluded: true },
    { keepingPolicy: "keep" as const },
  ]) {
    expect(automaticallyExpired({ ...claim, ...patch })).toBe(false);
    expect(resumesExpiredInterest({ ...claim, ...patch }, 4000)).toBe(false);
  }
});
