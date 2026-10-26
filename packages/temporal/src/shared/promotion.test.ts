import { describe, expect, it } from "vitest";
import {
  assertPromotionUrl,
  initialPromotionState,
  nextPromotionEligibleAt,
  policyEligibleAt,
  promotionEligibility,
  type PromotionObservation,
  type PromotionPreflight,
  type PromotionTarget,
} from "./promotion.ts";

const now = Date.parse("2026-10-25T12:00:00.000Z");
const target: PromotionTarget = {
  id: "pmc",
  name: "PMC",
  url: "https://www.planetminecraft.com/server/the-storm-3004178/",
  rulesUrl: "https://www.planetminecraft.com/rules/",
  account: "pmc",
  hosts: ["www.planetminecraft.com"],
  action: "bump",
  content: "directory",
  minimumIntervalSeconds: 86_400,
  notes: "Existing listing",
};
const observation: PromotionObservation = {
  id: "3235e21c-6ef7-46f8-bdc6-08f562018260",
  url: target.rulesUrl,
  text: "Bump once every 24 hours. No previous actions. Last bump was 2026-10-24T12:00:00.000Z.",
  capturedAt: new Date(now).toISOString(),
};
const preflight: PromotionPreflight = {
  policy: { kind: "rolling", maxActions: 1, windowSeconds: 86_400 },
  ruleObservationId: observation.id,
  ruleQuote: "Bump once every 24 hours.",
  historyObservationIds: [observation.id],
  historyComplete: true,
  previousActions: [],
  nextAllowedAt: null,
  equivalentPostExists: false,
  substantiveNewsAvailable: false,
  explanation: "Current rules and full relevant history were inspected.",
};

function decision(overrides: Partial<PromotionPreflight> = {}) {
  return promotionEligibility({
    target,
    now,
    preflight: { ...preflight, ...overrides },
    observations: [observation],
    state: {
      ...initialPromotionState("pmc", 900),
      checkedAt: "2026-10-25T10:00:00.000Z",
    },
  });
}

describe("promotion eligibility", () => {
  it("buffers the first observed eligibility and retains the same deadline on recheck", () => {
    const state = initialPromotionState("pmc", 900);
    const first = promotionEligibility({
      target,
      state,
      preflight,
      observations: [observation],
      now,
    });
    expect(first.allowed).toBe(false);
    expect(first.nextEligibleAt).toBe("2026-10-25T12:15:00.000Z");
    const second = promotionEligibility({
      target,
      state: {
        ...state,
        checkedAt: observation.capturedAt,
        nextEligibleAt: first.nextEligibleAt,
      },
      preflight,
      observations: [
        { ...observation, capturedAt: "2026-10-25T12:15:00.000Z" },
      ],
      now: now + 900_000,
    });
    expect(second.allowed).toBe(true);
  });
  it("applies the buffer even at the exact rolling cooldown boundary", () => {
    expect(
      decision({
        previousActions: [
          {
            occurredAt: "2026-10-24T12:00:00.000Z",
            observationId: observation.id,
            quote: "2026-10-24T12:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({
      allowed: false,
      nextEligibleAt: "2026-10-25T12:15:00.000Z",
    });
  });
  it.each([
    { historyComplete: false },
    { equivalentPostExists: true },
    { nextAllowedAt: "2026-10-26T00:00:00.000Z" },
  ])(
    "blocks incomplete, duplicate or platform-delayed actions: %o",
    (value) => {
      expect(decision(value).allowed).toBe(false);
    },
  );
  it("rejects invented or stale evidence", () => {
    expect(() =>
      decision({
        policy: { kind: "rolling", maxActions: 1, windowSeconds: 60 },
      }),
    ).toThrow("less restrictive");
    expect(() => decision({ ruleQuote: "You can post every minute" })).toThrow(
      "quote",
    );
    expect(() =>
      promotionEligibility({
        target,
        preflight,
        state: initialPromotionState("pmc", 900),
        observations: [
          { ...observation, capturedAt: "2026-10-25T11:54:59.000Z" },
        ],
        now,
      }),
    ).toThrow("Fresh");
  });
  it("counts filtered local attempts even after their public post disappears", () => {
    const state = {
      ...initialPromotionState("pmc", 900),
      checkedAt: observation.capturedAt,
      attempts: [
        {
          occurrenceId: "previous",
          attemptedAt: "2026-10-25T11:00:00.000Z",
          settledAt: "2026-10-25T11:00:00.000Z",
          status: "filtered" as const,
          receiptUrl: null,
          evidenceKey: null,
          contentHash: "abc",
        },
      ],
    };
    expect(
      promotionEligibility({
        target,
        state,
        preflight,
        observations: [observation],
        now,
      }).allowed,
    ).toBe(false);
  });
});

describe("posting rule evidence and receipt deadlines", () => {
  it("cannot reinterpret a rolling 24-hour rule as a midnight reset", () => {
    const quote = "Bump once every 24 hours, America/Los_Angeles.";
    expect(() =>
      promotionEligibility({
        target,
        now,
        state: initialPromotionState(target.id, 900),
        observations: [{ ...observation, text: quote }],
        preflight: {
          ...preflight,
          ruleQuote: quote,
          policy: {
            kind: "calendar-day",
            maxActions: 1,
            timezone: "America/Los_Angeles",
          },
        },
      }),
    ).toThrow("explicit quoted reset");
  });
  it.each([
    ["Post once every seven days.", 604_800],
    ["Bump once every twelve hours.", 43_200],
    ["Post once every twenty-four hours.", 86_400],
    ["Post at most once per week.", 604_800],
  ])("does not shorten spelled-out limits: %s", (quote, interval) => {
    const input = {
      target,
      now,
      state: initialPromotionState(target.id, 900),
      observations: [{ ...observation, text: quote }],
      preflight: {
        ...preflight,
        ruleQuote: quote,
        policy: {
          kind: "rolling" as const,
          maxActions: 1,
          windowSeconds: interval - 1,
        },
      },
    };
    expect(() => promotionEligibility(input)).toThrow("less restrictive");
    expect(() =>
      promotionEligibility({
        ...input,
        preflight: {
          ...input.preflight,
          policy: { ...input.preflight.policy, windowSeconds: interval },
        },
      }),
    ).not.toThrow();
  });
  it("anchors the next run to the settled receipt plus a new persisted buffer", () => {
    const state = {
      ...initialPromotionState(target.id, 900),
      preflight,
      attempts: [
        {
          occurrenceId: "previous",
          attemptedAt: "2026-10-25T11:59:00.000Z",
          settledAt: "2026-10-25T12:00:00.000Z",
          status: "verified" as const,
          receiptUrl: target.url,
          evidenceKey: "private/receipt",
          contentHash: "fixture",
        },
      ],
    };
    expect(nextPromotionEligibleAt(target, state, now)).toBe(
      "2026-10-26T12:15:00.000Z",
    );
  });
});

describe("promotion restrictions and window boundaries", () => {
  it("retains unknown effects and pending prerequisites", () => {
    expect(
      promotionEligibility({
        target: { ...target, action: "news" },
        state: initialPromotionState("pmc", 900),
        preflight: { ...preflight, substantiveNewsAvailable: true },
        observations: [observation],
        now,
      }).reason,
    ).toBe("No approved substantive news");
    expect(
      promotionEligibility({
        target: { ...target, action: "pending" },
        state: initialPromotionState("pmc", 900),
        preflight,
        observations: [observation],
        now,
      }).reason,
    ).toBe("Listing prerequisites unresolved");
  });
  it("uses the Nth newest action for a multi-post rolling window", () => {
    const policy = {
      kind: "rolling" as const,
      maxActions: 2,
      windowSeconds: 3600,
    };
    expect(
      policyEligibleAt(policy, [now - 1000, now - 2000, now - 4000], now),
    ).toBe(now - 2000 + 3_600_000);
    expect(() => policyEligibleAt(policy, [now + 1], now)).toThrow("future");
  });
  it("uses a real timezone calendar boundary across daylight saving", () => {
    const time = Date.parse("2026-11-01T08:30:00.000Z");
    expect(
      policyEligibleAt(
        {
          kind: "calendar-day",
          maxActions: 1,
          timezone: "America/Los_Angeles",
        },
        [time],
        time,
      ),
    ).toBe(Date.parse("2026-11-02T08:00:00.000Z"));
  });
  it("limits Reddit to old.reddit.com and the configured community/history", () => {
    const reddit = {
      ...target,
      id: "reddit-mcservers",
      url: "https://old.reddit.com/r/mcservers/",
      hosts: ["old.reddit.com"],
    };
    expect(() =>
      assertPromotionUrl(reddit, "https://www.reddit.com/r/mcservers/"),
    ).toThrow("scope");
    expect(() =>
      assertPromotionUrl(reddit, "https://old.reddit.com/r/other/submit"),
    ).toThrow("community");
    expect(
      assertPromotionUrl(
        reddit,
        "https://old.reddit.com/user/the-storm/submitted/",
      ).hostname,
    ).toBe("old.reddit.com");
    expect(() =>
      assertPromotionUrl(
        reddit,
        "https://user:password@old.reddit.com/r/mcservers/",
      ),
    ).toThrow("scope");
  });
});
