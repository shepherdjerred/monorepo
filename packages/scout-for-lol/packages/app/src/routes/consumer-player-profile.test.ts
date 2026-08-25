import { describe, expect, test } from "vitest";
import {
  isFreshConsumerProfileAccess,
  PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
  queueValue,
} from "#src/routes/consumer-player-profile.tsx";

describe("consumer profile queue filter", () => {
  test("maps member labels to report-lake queue values", () => {
    expect(queueValue("all")).toBeUndefined();
    expect(queueValue("solo")).toBe("solo");
    expect(queueValue("flex")).toBe("flex");
  });
});

describe("consumer profile authorization cache", () => {
  test("does not render a cached access success during its membership recheck", () => {
    expect(isFreshConsumerProfileAccess("available", true, true)).toBe(false);
    expect(isFreshConsumerProfileAccess("available", true, false)).toBe(true);
    expect(isFreshConsumerProfileAccess("no_shared_guild", true, false)).toBe(
      false,
    );
  });

  test("does not retain protected profile responses after route unmount", () => {
    expect(PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS).toEqual({
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: "always",
    });
  });
});
