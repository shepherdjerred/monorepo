import { describe, expect, it } from "vitest";
import { promotionPublicUrl, redactPromotionUrls } from "./redaction.ts";

describe("promotion observation redaction", () => {
  it("removes account/session navigation secrets while retaining search and listing identity", () => {
    expect(
      promotionPublicUrl(
        "https://example.com/server/123?csrf_token=fixture&search=storm&nonce=fixture",
      ),
    ).toBe("https://example.com/server/123?search=storm");
    expect(
      redactPromotionUrls(
        "A link: https://example.com/edit?id=123&auth=fixture-token",
      ),
    ).toBe("A link: https://example.com/edit?id=123");
  });
});
