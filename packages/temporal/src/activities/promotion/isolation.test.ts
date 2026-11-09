import { describe, expect, it } from "vitest";
import { promotionProviderUid } from "./isolation.ts";

describe("promotion process isolation", () => {
  it("requires a distinct deployed provider identity while allowing explicit local development", () => {
    expect(() =>
      promotionProviderUid({ TEMPORAL_NAMESPACE: "prod" }, 0),
    ).toThrow("distinct");
    expect(() =>
      promotionProviderUid(
        { TEMPORAL_NAMESPACE: "prod", AGENT_PROVIDER_UID: "1001" },
        1001,
      ),
    ).toThrow("distinct");
    expect(
      promotionProviderUid(
        { TEMPORAL_NAMESPACE: "prod", AGENT_PROVIDER_UID: "1001" },
        0,
      ),
    ).toBe(1001);
    expect(
      promotionProviderUid({ TEMPORAL_NAMESPACE: "dev" }, 501),
    ).toBeUndefined();
  });
});
