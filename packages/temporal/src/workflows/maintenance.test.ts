import { describe, expect, it } from "bun:test";
import { turboCacheCleanActivityOptions } from "./maintenance.ts";

describe("Turbo cache cleanup activity options", () => {
  it("allows a silent HTTP scan to use its full start-to-close window", () => {
    expect(turboCacheCleanActivityOptions.startToCloseTimeout).toBe(
      "5 minutes",
    );
    expect("heartbeatTimeout" in turboCacheCleanActivityOptions).toBeFalse();
    expect(turboCacheCleanActivityOptions.retry.maximumAttempts).toBe(3);
  });
});
