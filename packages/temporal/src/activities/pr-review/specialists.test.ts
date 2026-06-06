import { describe, expect, it } from "bun:test";
import { shouldStopSpecialistFanout } from "./specialists.ts";

class AnthropicRateLimitFixture extends Error {
  readonly status = 429;
  readonly error = { type: "rate_limit_error" };
}

describe("shouldStopSpecialistFanout", () => {
  it("stops remaining specialist passes after Anthropic provider limits", () => {
    expect(
      shouldStopSpecialistFanout(
        new AnthropicRateLimitFixture(
          "429 rate_limit_error request_id: req_rate_limit_1",
        ),
      ),
    ).toBe(true);
  });

  it("does not stop remaining specialist passes for ordinary failures", () => {
    expect(shouldStopSpecialistFanout(new Error("plain failure"))).toBe(false);
  });
});
