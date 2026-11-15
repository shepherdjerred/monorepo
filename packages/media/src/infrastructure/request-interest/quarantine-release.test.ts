import { expect, test } from "vitest";
import { hasFollowingRequestInterest } from "#infrastructure/request-claims.ts";
import {
  quarantinedReleaseObservationOnly,
  type QuarantineReleaseScope,
} from "./quarantine-release.ts";

const root = {
  userId: "member",
  active: true,
  direct: true,
  excluded: false,
  keepingPolicy: "temporary" as const,
  interestState: "expired" as const,
  interestReleasedAt: new Date(1000),
  interestReleaseReason: "lost_interest",
};
const household = {
  ownerConsent: false,
  recipients: [{ userId: "member" }],
  reason: null,
  libraryKeep: false,
};
function scope(): QuarantineReleaseScope {
  const claim = { ...root, coverageSources: [] };
  return {
    participants: [{ id: "member", restricted: false, role: "member" }],
    household: { ...household, roots: [root] },
    claims: [claim],
    cohortClaims: [claim],
  };
}

test.each([
  "lost_interest",
  "finished_manually",
  "dropped_manually",
  "watched",
  "series_finished",
] as const)("%s settles without renewing or granting restoration", (reason) => {
  const released = {
    ...root,
    interestState:
      reason === "lost_interest"
        ? ("expired" as const)
        : reason === "dropped_manually"
          ? ("dropped" as const)
          : ("finished" as const),
    interestReleaseReason: reason,
  };
  const claim = { ...released, coverageSources: [] };
  expect(
    quarantinedReleaseObservationOnly(
      {
        participants: [{ id: "member", restricted: false, role: "member" }],
        household: { ...household, roots: [released] },
        claims: [claim],
        cohortClaims: [claim],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(true);
});

test("a genuine following parent overrides the same user's Finished direct leaf", () => {
  const parent = {
    ...root,
    interestState: "following" as const,
    interestReleasedAt: null,
    interestReleaseReason: null,
  };
  const claim = {
    ...root,
    interestState: "finished" as const,
    interestReleaseReason: "finished_manually",
    coverageSources: [{ active: true, rootRequest: parent }],
  };
  expect(hasFollowingRequestInterest(claim)).toBe(true);
  expect(
    quarantinedReleaseObservationOnly(
      {
        participants: [{ id: "member", restricted: false, role: "member" }],
        household: { ...household, roots: [claim, parent] },
        claims: [claim],
        cohortClaims: [claim],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(false);
  for (const invalid of [
    { active: false },
    { excluded: true },
    { direct: false },
    { interestState: "dropped" as const },
  ])
    expect(
      hasFollowingRequestInterest({
        ...claim,
        coverageSources: [
          { active: true, rootRequest: { ...parent, ...invalid } },
        ],
      }),
    ).toBe(false);
  expect(
    hasFollowingRequestInterest({
      ...claim,
      coverageSources: [{ active: false, rootRequest: parent }],
    }),
  ).toBe(false);
  expect(hasFollowingRequestInterest({ ...claim, excluded: true })).toBe(false);
  expect(hasFollowingRequestInterest({ ...parent, coverageSources: [] })).toBe(
    true,
  );
});

test("unknown release metadata and restricted/unmapped actors keep the existing protective path", () => {
  const current = scope();
  expect(
    quarantinedReleaseObservationOnly(current, "other", new Date(2000)),
  ).toBe(false);
  expect(
    quarantinedReleaseObservationOnly(
      {
        ...current,
        participants: [{ id: "member", restricted: true, role: "member" }],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(false);
  for (const patch of [
    { interestReleaseReason: null },
    { interestReleasedAt: null },
    { interestReleasedAt: new Date(3000) },
  ]) {
    const claim = { ...root, ...patch, coverageSources: [] };
    expect(
      quarantinedReleaseObservationOnly(
        {
          ...current,
          household: { ...household, roots: [claim] },
          claims: [claim],
          cohortClaims: [claim],
        },
        "member",
        new Date(2000),
      ),
    ).toBe(false);
  }
});

test("manual and automatic releases both remain observational without renewed consent", () => {
  const current = scope();
  expect(
    quarantinedReleaseObservationOnly(
      {
        ...current,
        household: {
          ...household,
          roots: [
            root,
            {
              ...root,
              interestState: "finished",
              interestReleaseReason: "watched",
            },
          ],
        },
      },
      "member",
      new Date(2000),
    ),
  ).toBe(true);
});

test("automatic Finished siblings remain observational while unknown or inactive claims protect", () => {
  const current = scope();
  const manual = {
    ...root,
    mediaId: "selected",
    interestState: "finished" as const,
    interestReleaseReason: "finished_manually",
    coverageSources: [],
  };
  const automatic = {
    ...root,
    mediaId: "sibling",
    interestState: "finished" as const,
    interestReleaseReason: "watched",
    coverageSources: [],
  };
  const siblingScope = {
    ...current,
    household: { ...household, roots: [manual] },
    claims: [manual],
    cohortClaims: [manual, automatic],
  };
  expect(
    quarantinedReleaseObservationOnly(siblingScope, "member", new Date(2000)),
  ).toBe(true);
  expect(
    quarantinedReleaseObservationOnly(
      {
        ...siblingScope,
        cohortClaims: [
          manual,
          { ...automatic, interestReleaseReason: "finished_manually" },
        ],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(true);
  expect(
    quarantinedReleaseObservationOnly(
      {
        ...siblingScope,
        cohortClaims: [manual, { ...automatic, interestReleaseReason: null }],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(false);
  const inheritedSibling = {
    ...automatic,
    direct: false,
    coverageSources: [{ active: true, rootRequest: automatic }],
  };
  expect(
    quarantinedReleaseObservationOnly(
      { ...siblingScope, cohortClaims: [manual, inheritedSibling] },
      "member",
      new Date(2000),
    ),
  ).toBe(true);
  expect(
    quarantinedReleaseObservationOnly(
      { ...siblingScope, cohortClaims: [manual, { ...manual, active: false }] },
      "member",
      new Date(2000),
    ),
  ).toBe(false);
});

test("only the current explicit Temporary owner without request or following/Keep authority observes without restore", () => {
  const owner: QuarantineReleaseScope = {
    ...scope(),
    participants: [{ id: "member", role: "owner", restricted: false }],
    household: { ...household, roots: [], ownerConsent: true },
    claims: [],
    cohortClaims: [],
  };
  expect(
    quarantinedReleaseObservationOnly(owner, "member", new Date(2000)),
  ).toBe(true);
  for (const patch of [
    { ownerConsent: false },
    { libraryKeep: true },
    { reason: "requester_still_following" },
    { recipients: [] },
  ])
    expect(
      quarantinedReleaseObservationOnly(
        { ...owner, household: { ...owner.household, ...patch } },
        "member",
        new Date(2000),
      ),
    ).toBe(false);
  for (const user of [
    { id: "member", role: "member", restricted: false },
    { id: "member", role: "owner", restricted: true },
  ])
    expect(
      quarantinedReleaseObservationOnly(
        { ...owner, participants: [user] },
        "member",
        new Date(2000),
      ),
    ).toBe(false);
  for (const claim of [
    { ...root, interestState: "following" as const, coverageSources: [] },
    { ...root, keepingPolicy: "keep" as const, coverageSources: [] },
  ])
    expect(
      quarantinedReleaseObservationOnly(
        { ...owner, cohortClaims: [claim] },
        "member",
        new Date(2000),
      ),
    ).toBe(false);
  const automatic = {
    ...root,
    interestState: "finished" as const,
    interestReleaseReason: "watched",
    coverageSources: [],
  };
  expect(
    quarantinedReleaseObservationOnly(
      { ...owner, cohortClaims: [automatic] },
      "member",
      new Date(2000),
    ),
  ).toBe(true);
  expect(
    quarantinedReleaseObservationOnly(
      {
        ...owner,
        cohortClaims: [{ ...automatic, interestReleaseReason: null }],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(false);
  expect(
    quarantinedReleaseObservationOnly(
      {
        ...owner,
        cohortClaims: [
          { ...automatic, interestReleaseReason: "finished_manually" },
        ],
      },
      "member",
      new Date(2000),
    ),
  ).toBe(true);
});
