import { describe, expect, it } from "vitest";
import {
  promotionPublicUrl,
  promotionSecretTokens,
  redactPromotionUrls,
} from "./redaction.ts";
import { redactSecrets } from "#shared/redact.ts";

describe("promotion observation redaction", () => {
  it("preserves public profile names and destination IDs while masking login and worker secrets", () => {
    const logins = {
      "minecraft-serverlist": {
        username: "PublicProfile",
        password: "fixture-private-password",
      },
    };
    const tokens = promotionSecretTokens(logins, {
      STORM_PROMOTION_LOGINS: JSON.stringify(logins),
      PINCHTAB_TOKEN: "fixture-browser-token",
    });
    expect(
      redactSecrets(
        "https://minecraft-serverlist.com/user/PublicProfile fixture-private-password fixture-browser-token",
        tokens,
      ),
    ).toBe("https://minecraft-serverlist.com/user/PublicProfile *** ***");
    expect(redactSecrets(JSON.stringify(logins), tokens)).toBe("***");
  });
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
