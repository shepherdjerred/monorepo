import { describe, expect, test } from "vitest";
import { agentChatTitleFromPrompt } from "./agent-chat-ingress.ts";

describe("agentChatTitleFromPrompt", () => {
  test("collapses whitespace and keeps short prompts whole", () => {
    expect(agentChatTitleFromPrompt("  check\n the   deploy ")).toBe(
      "check the deploy",
    );
  });

  test("caps titles at 80 units including the ellipsis", () => {
    const title = agentChatTitleFromPrompt("x".repeat(200));
    expect(title).toBe(`${"x".repeat(77)}...`);
  });

  test("never splits an emoji at the cut", () => {
    const title = agentChatTitleFromPrompt(
      `${"x".repeat(76)}🧪${"y".repeat(10)}`,
    );
    expect(title).toBe(`${"x".repeat(76)}...`);
    expect(title.isWellFormed()).toBe(true);
  });
});
