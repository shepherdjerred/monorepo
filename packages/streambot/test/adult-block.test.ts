import { describe, expect, test } from "bun:test";
import {
  isBlockedHost,
  isBlockedSource,
  isBlockedText,
  isBlockedUrl,
  shameMessage,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";

describe("isBlockedHost", () => {
  test("blocks known adult domains and their subdomains", () => {
    expect(isBlockedHost("pornhub.com")).toBe(true);
    expect(isBlockedHost("www.pornhub.com")).toBe(true);
    expect(isBlockedHost("onlyfans.com")).toBe(true);
  });

  test("does not block innocuous hosts that merely contain a substring", () => {
    expect(isBlockedHost("popcorn.com")).toBe(false); // contains "porn"
    expect(isBlockedHost("essex.gov.uk")).toBe(false); // contains "sex"
    expect(isBlockedHost("youtube.com")).toBe(false);
  });
});

describe("isBlockedUrl", () => {
  test("blocks adult URLs, allows others, ignores garbage", () => {
    expect(isBlockedUrl("https://www.pornhub.com/view")).toBe(true);
    expect(isBlockedUrl("https://youtu.be/abc")).toBe(false);
    expect(isBlockedUrl("not a url")).toBe(false);
  });
});

describe("isBlockedText", () => {
  test("blocks distinctive adult tokens by word boundary", () => {
    expect(isBlockedText("free porn video")).toBe(true);
    expect(isBlockedText("HENTAI compilation")).toBe(true);
    expect(isBlockedText("popcorn time")).toBe(false);
    expect(isBlockedText("the essex files")).toBe(false);
  });
});

describe("isBlockedSource", () => {
  test("evaluates url and search sources, never blocks local files", () => {
    expect(isBlockedSource({ kind: "url", url: "https://pornhub.com/x" })).toBe(
      true,
    );
    expect(isBlockedSource({ kind: "search", query: "porn" })).toBe(true);
    expect(isBlockedSource({ kind: "search", query: "lofi beats" })).toBe(
      false,
    );
    expect(
      isBlockedSource({ kind: "file", path: "/v/porn.mkv", title: "porn" }),
    ).toBe(false);
  });
});

describe("shameMessage", () => {
  test("mentions the user and the kids", () => {
    const userId = UserIdSchema.parse("160509172704739328");
    const message = shameMessage(userId, () => 0);
    expect(message).toContain("160509172704739328");
    expect(message.toLowerCase()).toContain("kids");
  });
});
