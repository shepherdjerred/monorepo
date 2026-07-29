import { describe, expect, test } from "bun:test";
import { parsePullRequestAuthor } from "./github.ts";

describe("parsePullRequestAuthor", () => {
  test("parses a GitHub App bot author", () => {
    expect(
      parsePullRequestAuthor({
        user: { login: "long-summer-intern[bot]", type: "Bot" },
      }),
    ).toEqual({ login: "long-summer-intern[bot]", type: "Bot" });
  });

  test("parses a human author", () => {
    expect(
      parsePullRequestAuthor({
        user: { login: "shepherdjerred", type: "User" },
      }),
    ).toEqual({ login: "shepherdjerred", type: "User" });
  });

  test("preserves an unknown non-empty account type for fail-closed policy", () => {
    expect(
      parsePullRequestAuthor({
        user: { login: "future-service", type: "ServiceAccount" },
      }),
    ).toEqual({ login: "future-service", type: "ServiceAccount" });
  });

  test.each([
    ["non-object response", null],
    ["missing user", {}],
    ["non-object user", { user: "long-summer-intern[bot]" }],
    ["missing login", { user: { type: "Bot" } }],
    ["empty login", { user: { login: "", type: "Bot" } }],
    ["missing type", { user: { login: "long-summer-intern[bot]" } }],
    ["empty type", { user: { login: "long-summer-intern[bot]", type: "" } }],
  ])("rejects %s", (_description, payload) => {
    expect(() => parsePullRequestAuthor(payload)).toThrow();
  });
});
