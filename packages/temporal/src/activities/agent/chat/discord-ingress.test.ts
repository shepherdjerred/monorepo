import { ApplicationFailure } from "@temporalio/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as TemporalActivity from "@temporalio/activity";
import {
  chunkDiscordAgentChatText,
  deliverDiscordAgentChatMessage,
} from "./discord-ingress.ts";

const activityMocks = vi.hoisted(() => ({
  cancellation: new AbortController(),
  restPost: vi.fn(),
}));

vi.mock("@temporalio/activity", async (importOriginal) => {
  const original = await importOriginal<typeof TemporalActivity>();
  return {
    ...original,
    Context: {
      current: () => ({
        cancellationSignal: activityMocks.cancellation.signal,
      }),
    },
  };
});

vi.mock("discord.js", () => ({
  REST: class {
    public setToken(): this {
      return this;
    }

    public readonly post = activityMocks.restPost;
  },
}));

beforeEach(() => {
  activityMocks.cancellation = new AbortController();
  vi.clearAllMocks();
});

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
    activityMocks.restPost.mockRejectedValueOnce({ status: 403 });
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
    activityMocks.restPost.mockRejectedValueOnce(failure);
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

  it("aborts an in-flight Discord write when the Activity is canceled", async () => {
    activityMocks.restPost.mockImplementationOnce(
      (_route: string, options: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          const signal = options.signal;
          if (signal === undefined) {
            reject(new Error("missing Discord request signal"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new Error("delivery canceled")),
            { once: true },
          );
        }),
    );
    const previousToken = Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
    Bun.env["AGENT_CHAT_DISCORD_TOKEN"] = "test-token";
    try {
      const delivery = deliverDiscordAgentChatMessage({
        channelId: "223456789012345678",
        content: "result",
        nonce: "32345678901234567800",
      });
      await vi.waitFor(() => {
        expect(activityMocks.restPost).toHaveBeenCalledOnce();
      });

      activityMocks.cancellation.abort();

      await expect(delivery).rejects.toThrow("delivery canceled");
      expect(activityMocks.restPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally {
      if (previousToken === undefined) {
        delete Bun.env["AGENT_CHAT_DISCORD_TOKEN"];
      } else {
        Bun.env["AGENT_CHAT_DISCORD_TOKEN"] = previousToken;
      }
    }
  });
});
