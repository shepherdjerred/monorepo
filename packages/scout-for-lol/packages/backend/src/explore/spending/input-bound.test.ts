import { describe, expect, test } from "vitest";
import {
  EXPLORE_IMAGE_INPUT_BOUND,
  exploreProviderInputBound,
} from "#src/explore/spending/input-bound.ts";

const text = [{ role: "user", content: [{ type: "text", text: "Why?" }] }];
const screenshot = new Uint8Array(2 * 1024 * 1024).fill(7);

describe("the provider input bound", () => {
  test("counts an image by a fixed reservation, not its encoded size", () => {
    const withBytes = exploreProviderInputBound({
      prompt: [
        {
          role: "user",
          content: [
            { type: "text", text: "Why?" },
            { type: "file", mediaType: "image/png", data: screenshot },
          ],
        },
      ],
    });
    const plain = exploreProviderInputBound({ prompt: text });
    expect(withBytes - plain).toBeGreaterThanOrEqual(EXPLORE_IMAGE_INPUT_BOUND);
    expect(withBytes - plain).toBeLessThan(EXPLORE_IMAGE_INPUT_BOUND + 200);
  });

  test("treats a base64 image part the same way", () => {
    const bound = exploreProviderInputBound({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/jpeg",
              data: Buffer.from(screenshot).toString("base64"),
            },
          ],
        },
      ],
    });
    expect(bound).toBeLessThan(EXPLORE_IMAGE_INPUT_BOUND + 10_000);
  });

  test("still counts every text byte", () => {
    const long = "x".repeat(300_000);
    expect(
      exploreProviderInputBound({ prompt: [{ role: "user", content: long }] }),
    ).toBeGreaterThan(300_000);
  });
});
