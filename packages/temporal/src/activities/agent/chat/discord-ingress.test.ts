import { ApplicationFailure } from "@temporalio/common";
import { describe, expect, it, vi } from "vitest";
import {
  chunkDiscordAgentChatText,
  deliverDiscordAgentChatMessage,
} from "./discord-ingress.ts";

const { restPost } = vi.hoisted(() => ({ restPost: vi.fn() }));

vi.mock("discord.js", () => ({
  REST: class {
    public setToken(): this {
      return this;
    }

    public readonly post = restPost;
  },
}));

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

  it("does not retry definitive Discord delivery rejections", async () => {
    restPost.mockRejectedValueOnce({ status: 403 });
    const previousToken = Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
    Bun.env["AGENT_CHAT_DISCORD_TOKEN"] = "test-token";
    try {
      const failure: unknown = await deliverDiscordAgentChatMessage({
        channelId: "223456789012345678",
        content: "result",
        nonce: "12345678901234567800",
      }).catch((error: unknown) => error);
      expect(failure).toMatchObject({
        type: "DiscordAgentChatDeliveryRejected",
        nonRetryable: true,
      });
      expect(failure).toBeInstanceOf(ApplicationFailure);
    } finally {
      if (previousToken === undefined) {
        delete Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
      } else {
        Bun.env["AGENT_CHAT_DISCORD_TOKEN"] = previousToken;
      }
    }
  });

  it("keeps transient Discord delivery failures retryable", async () => {
    const failure = { status: 503 };
    restPost.mockRejectedValueOnce(failure);
    const previousToken = Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
    Bun.env["AGENT_CHAT_DISCORD_TOKEN"] = "test-token";
    try {
      await expect(
        deliverDiscordAgentChatMessage({
          channelId: "223456789012345678",
          content: "result",
          nonce: "22345678901234567800",
        }),
      ).rejects.toBe(failure);
    } finally {
      if (previousToken === undefined) {
        delete Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
      } else {
        Bun.env["AGENT_CHAT_DISCORD_TOKEN"] = previousToken;
      }
    }
  });
});
