import { describe, expect, it } from "vitest";
import { chunkDiscordAgentChatText } from "./discord-ingress.ts";

describe("Discord agent chat activities", () => {
  it("chunks provider output at Discord's message boundary", () => {
    const chunks = chunkDiscordAgentChatText("x".repeat(4001));

    expect(chunks.map((chunk) => chunk.length)).toEqual([2000, 2000, 1]);
    expect(chunkDiscordAgentChatText("")).toEqual([
      "(Agent returned no text.)",
    ]);
  });

  it("does not split an astral character across messages", () => {
    const text = `${"x".repeat(1999)}🧪y`;
    const chunks = chunkDiscordAgentChatText(text);

    expect(chunks).toEqual(["x".repeat(1999), "🧪y"]);
    expect(chunks.join("")).toBe(text);
  });
});
