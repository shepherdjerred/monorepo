import { describe, expect, test } from "vitest";
import {
  isFreshConsumerProfileAccess,
  PROTECTED_CONSUMER_PROFILE_QUERY_OPTIONS,
} from "#src/routes/consumer-player-profile.tsx";

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
