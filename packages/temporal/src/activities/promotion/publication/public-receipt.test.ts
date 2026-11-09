import { describe, expect, it } from "vitest";
import { publicRedditReceiptUrl } from "./public-receipt.ts";

describe("public Reddit receipt URLs", () => {
  it("keeps posting on old Reddit but verifies the public www permalink", () => {
    expect(
      publicRedditReceiptUrl(
        "https://old.reddit.com/r/MinecraftServer/comments/abc/title/?tracking=value#anchor",
      ),
    ).toBe("https://www.reddit.com/r/MinecraftServer/comments/abc/title/");
  });
  it("removes transient challenge parameters from the captured canonical URL", () => {
    expect(
      publicRedditReceiptUrl(
        "https://www.reddit.com/r/MinecraftServer/comments/abc/title/?js_challenge=1",
      ),
    ).toBe("https://www.reddit.com/r/MinecraftServer/comments/abc/title/");
  });
  it.each([
    "https://example.com/r/MinecraftServer/comments/abc/title/",
    "https://old.reddit.com/r/MinecraftServer/submit",
  ])("rejects a non-post receipt: %s", (url) => {
    expect(() => publicRedditReceiptUrl(url)).toThrow("permalink");
  });
});
