import { describe, expect, test } from "vitest";

import { BACKGROUND_ACTIVITY_RETRY_POLICY } from "./activity-options.ts";

describe("background activity retry ownership", () => {
  test("keeps four attempts for transient failures and stops quota retries", () => {
    expect(BACKGROUND_ACTIVITY_RETRY_POLICY.maximumAttempts).toBe(4);
    expect(BACKGROUND_ACTIVITY_RETRY_POLICY.nonRetryableErrorTypes).toContain(
      "ProviderQuotaExhausted",
    );
  });
});
