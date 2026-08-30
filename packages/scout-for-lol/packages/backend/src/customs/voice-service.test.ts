import { describe, expect, test } from "vitest";
import {
  captureCustomVoiceArrangement,
  retryCustomVoiceOperation,
} from "#src/customs/voice-service.ts";

describe("Customs voice recovery", () => {
  test("retries a failed Discord operation with bounded backoff", async () => {
    let attempts = 0;
    const delays: number[] = [];
    await expect(
      retryCustomVoiceOperation(
        () => {
          attempts += 1;
          if (attempts < 3) throw new Error("Discord unavailable");
          return Promise.resolve("moved");
        },
        (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      ),
    ).resolves.toBe("moved");
    expect(attempts).toBe(3);
    expect(delays).toEqual([250, 500]);
  });

  test("fails after exactly three attempts", async () => {
    let attempts = 0;
    await expect(
      retryCustomVoiceOperation(
        () => {
          attempts += 1;
          return Promise.reject(new Error("Discord unavailable"));
        },
        () => Promise.resolve(),
      ),
    ).rejects.toThrow("after three attempts");
    expect(attempts).toBe(3);
  });

  test("preserves created channel IDs when moving a player fails", async () => {
    const channels = { teamA: "channel-a", teamB: "channel-b" };
    const result = await captureCustomVoiceArrangement(channels, () =>
      Promise.reject(new Error("move failed")),
    );

    expect(result.ok).toBe(false);
    expect(result.channels).toEqual(channels);
  });
});
