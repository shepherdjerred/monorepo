import { describe, expect, test, vi } from "vitest";
import { type DaemonContext, routeRequest } from "#lib/discord/handlers.ts";
import { ReadResponseSchema } from "#lib/discord/ipc.ts";

function createDualIdentityContext(
  botChannel: unknown,
  userChannel: unknown,
): DaemonContext {
  const ctx: DaemonContext = {
    bot: null,
    user: null,
    voice: null,
    startedAt: new Date().toISOString(),
    ttlSeconds: 3600,
    lastActivity: Date.now(),
  };
  Object.assign(ctx, {
    bot: { channels: { fetch: vi.fn().mockResolvedValue(botChannel) } },
    user: { channels: { fetch: vi.fn().mockResolvedValue(userChannel) } },
  });
  return ctx;
}

function postRead(ctx: DaemonContext, payload: Record<string, unknown>) {
  const url = new URL("http://localhost/read");
  const req = new Request(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return routeRequest(ctx, url, req);
}

describe("discord read handler", () => {
  test("uses user identity when explicitly requested even when bot is present", async () => {
    const mockUserChannel = {
      isText: () => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(
          new Map([
            [
              "m1",
              {
                id: "m1",
                channelId: "c1",
                author: { id: "u1", tag: "user#1", bot: false },
                content: "user visible message",
                createdAt: new Date("2026-06-12T00:00:00Z"),
                embeds: [],
                attachments: new Map(),
                mentions: {
                  users: new Map(),
                  roles: new Map(),
                  everyone: false,
                },
              },
            ],
          ]),
        ),
      },
    };

    const mockBotChannel = {
      isTextBased: () => true,
      messages: {
        fetch: vi.fn().mockRejectedValue(new Error("Missing Access")),
      },
    };

    const ctx = createDualIdentityContext(mockBotChannel, mockUserChannel);
    const res = await postRead(ctx, { channelId: "c1", limit: 10, as: "user" });

    expect(res.status).toBe(200);
    const body = ReadResponseSchema.parse(await res.json());
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.content).toBe("user visible message");
    expect(mockUserChannel.messages.fetch).toHaveBeenCalledWith({ limit: 10 });
    expect(mockBotChannel.messages.fetch).not.toHaveBeenCalled();
  });

  test("defaults to bot identity when bot is present and as is omitted", async () => {
    const mockBotChannel = {
      isTextBased: () => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(new Map()),
      },
    };

    const mockUserChannel = {
      isText: () => true,
      messages: {
        fetch: vi.fn().mockResolvedValue(new Map()),
      },
    };

    const ctx = createDualIdentityContext(mockBotChannel, mockUserChannel);
    const res = await postRead(ctx, { channelId: "c1", limit: 5 });

    expect(res.status).toBe(200);
    expect(mockBotChannel.messages.fetch).toHaveBeenCalledWith({ limit: 5 });
    expect(mockUserChannel.messages.fetch).not.toHaveBeenCalled();
  });
});
