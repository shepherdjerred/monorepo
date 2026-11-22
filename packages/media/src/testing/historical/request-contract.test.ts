import { expect, test } from "vitest";
import { HistoricalMovieOptionsSchema } from "./request-contract.ts";
import {
  requestKeepingPolicy,
  renewedInterest,
} from "#infrastructure/request-interest/policy.ts";

test("historical request options exclude later household authority", () => {
  expect(
    HistoricalMovieOptionsSchema.parse({ subtitleLanguages: ["en"] }),
  ).toEqual({ subtitleLanguages: ["en"] });
  expect(() =>
    HistoricalMovieOptionsSchema.parse({
      subtitleLanguages: [],
      keepingPolicy: "keep",
    }),
  ).toThrow();
});

test("current fresh owner consent still requires an explicit policy and renews interest", () => {
  const owner = {
    id: crypto.randomUUID(),
    plexAccountId: "contract-owner",
    displayName: "Owner",
    role: "owner" as const,
    restricted: false,
    version: 0,
  };
  expect(() => requestKeepingPolicy(owner, undefined, null)).toThrow(
    "Choose Keep for good or Keep just for now",
  );
  expect(requestKeepingPolicy(owner, "temporary", null)).toBe("temporary");
  const now = new Date("2026-11-14T00:00:00.000Z");
  expect(renewedInterest(now)).toMatchObject({
    interestState: "following",
    interestRenewedAt: now,
    interestNoticeAcceptedAt: null,
    interestReleasedAt: null,
  });
});
