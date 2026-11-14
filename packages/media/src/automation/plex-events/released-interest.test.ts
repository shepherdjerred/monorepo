import { expect, test } from "vitest";
import {
  currentReleasedInterest,
  releasedWatchMayKeepWarning,
  type ReleasedWatchScope,
} from "./released-interest.ts";

const now = new Date(2000);
const root = {
  active: true,
  direct: true,
  excluded: false,
  keepingPolicy: "temporary" as const,
  interestState: "expired" as const,
  interestReleasedAt: new Date(1000),
  interestReleaseReason: "lost_interest",
};
function scope(): ReleasedWatchScope {
  const claim = { ...root, userId: "member", coverageSources: [] };
  return {
    household: {
      reason: null,
      roots: [root],
      ownerConsent: false,
      recipients: [{ userId: "member" }],
    },
    participants: [{ id: "member", restricted: false, role: "member" }],
    claims: [claim],
    cohortClaims: [claim],
  };
}

test("released or pending-renewal claims preserve stable native false warnings", () => {
  const current = scope();
  expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(true);
  current.household.reason = "requester_playback_renewal_pending";
  expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(true);
  expect(releasedWatchMayKeepWarning(current, "other", now)).toBe(false);
  expect(
    currentReleasedInterest(
      {
        ...root,
        interestState: "finished",
        interestReleaseReason: "finished_manually",
      },
      now,
    ),
  ).toBe(true);
});

test("following, unknown, Keep, future release and unresolved co-requesters keep unwatch safety", () => {
  for (const patch of [
    { interestState: "following" as const },
    { interestReleasedAt: null },
    { interestReleaseReason: null },
    { keepingPolicy: "keep" as const },
    { interestReleasedAt: new Date(3000) },
    { active: false },
    { excluded: true },
  ]) {
    const current = scope();
    current.cohortClaims.push({
      ...root,
      ...patch,
      userId: "co-requester",
      coverageSources: [],
    });
    expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(false);
  }
  const current = scope();
  current.household.reason = "ancestor_keep_hold";
  expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(false);
});

test("explicit current owner Temporary consent is required for an unclaimed library", () => {
  const current = scope();
  current.household.roots = [];
  current.claims = [];
  current.cohortClaims = [];
  current.participants = [{ id: "member", restricted: false, role: "owner" }];
  expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(false);
  current.household.ownerConsent = true;
  expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(true);
  current.participants = [{ id: "member", restricted: true, role: "owner" }];
  expect(releasedWatchMayKeepWarning(current, "member", now)).toBe(false);
});
