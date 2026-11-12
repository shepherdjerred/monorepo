import { expect, it, vi } from "vitest";
import { Message, RateLimitError, TextChannel } from "discord.js-selfbot-v13";
import { z } from "zod";
import { routeRequest, type DaemonContext } from "#lib/discord/handlers.ts";
import { createDiscordUserClient } from "#lib/discord/serve.ts";
import { ApplicationCommandIndex } from "#lib/discord/application-commands.ts";
import {
  DiscordCooldownError,
  throwDiscordWriteError,
} from "#lib/discord/cooldown.ts";

const messagePath = "/channels/123/messages";
function rateLimit(path = messagePath, timeout = 100) {
  const error: unknown = Reflect.construct(RateLimitError, [
    {
      timeout,
      method: "post",
      path,
      route: path,
      global: false,
      limit: 1,
    },
  ]);
  if (!(error instanceof RateLimitError))
    throw new TypeError("Expected SDK rate limit");
  return error;
}

it("classifies only the actual SDK's rejected matching mutation", () => {
  expect(() => throwDiscordWriteError(rateLimit(), messagePath)).toThrow(
    DiscordCooldownError,
  );
  for (const error of [
    rateLimit("/channels/other/messages"),
    rateLimit(messagePath, NaN),
    rateLimit(messagePath, -1),
    new Error("HTTP 429"),
    { name: "RateLimitError", timeout: 100, path: messagePath, method: "post" },
  ]) {
    try {
      throwDiscordWriteError(error, messagePath);
    } catch (error_) {
      expect(error_).toBe(error);
    }
  }
});

it("lets the SDK wait for a rate-limited command-index GET and retry to success", async () => {
  const client = createDiscordUserClient();
  const commandIndexPath = "/guilds/123/application-command-index";
  const requestTimes: number[] = [];
  const fetch = vi.spyOn(client.rest, "fetch").mockImplementation(async () => {
    requestTimes.push(Date.now());
    if (requestTimes.length === 1)
      return Response.json(
        { retry_after: 0.1 },
        {
          status: 429,
          headers: {
            "retry-after": "0.1",
            "x-ratelimit-remaining": "0",
            "x-ratelimit-limit": "1",
            "x-ratelimit-reset-after": "0.1",
          },
        },
      );
    return Response.json({ applications: [], application_commands: [] });
  });
  const request = z
    .custom<
      (
        method: string,
        path: string,
        options: { auth: false; route: string },
      ) => Promise<unknown>
    >((value) => typeof value === "function")
    .parse(Reflect.get(client.rest, "request"));
  try {
    const result = await request.call(client.rest, "get", commandIndexPath, {
      auth: false,
      route: commandIndexPath,
    });
    expect(ApplicationCommandIndex.parse(result)).toEqual({
      applications: [],
      application_commands: [],
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [initial, retry] = z
      .tuple([z.number(), z.number()])
      .parse(requestTimes);
    expect(retry - initial).toBeGreaterThanOrEqual(100);
  } finally {
    client.destroy();
    vi.restoreAllMocks();
  }
});

function slashFixture(mode: "cooldown" | "fast-reply") {
  const client = createDiscordUserClient();
  client.token = "offline-test-fixture";
  const value: unknown = Reflect.construct(TextChannel, [
    undefined,
    { id: "123", type: "GUILD_TEXT" },
    client,
  ]);
  if (!(value instanceof TextChannel))
    throw new TypeError("Expected SDK channel");
  const channel = value;
  vi.spyOn(client.channels, "fetch").mockResolvedValue(channel);
  const fetch = vi
    .spyOn(client.rest, "fetch")
    .mockImplementation(async (url) => {
      if (z.string().parse(url).endsWith("/interactions")) {
        if (mode === "cooldown")
          return Response.json(
            { retry_after: 0.1 },
            {
              status: 429,
              headers: {
                "retry-after": "0.1",
                "x-ratelimit-remaining": "0",
                "x-ratelimit-limit": "1",
                "x-ratelimit-reset-after": "0.1",
              },
            },
          );
        return new Response(null, { status: 204 });
      }
      return Response.json({
        applications: [{ id: "999" }],
        application_commands: [
          {
            id: "456",
            application_id: "999",
            name: "bump",
            type: 1,
            version: "1",
            options: [],
          },
        ],
      });
    });
  if (mode === "fast-reply")
    client.on("apiRequest", (request) => {
      const parsed = z
        .object({
          path: z.string(),
          options: z.object({ data: z.unknown().optional() }),
        })
        .parse(request);
      if (parsed.path !== "/interactions") return;
      const { nonce } = z
        .object({ nonce: z.string() })
        .parse(parsed.options.data);
      expect(client.listenerCount("messageCreate")).toBeGreaterThan(0);
      const reply: unknown = Reflect.construct(Message, [
        client,
        {
          id: "1560703712056443081",
          channel_id: "123",
          nonce,
          content: "Bump done",
          author: { id: "999", username: "fixture", discriminator: "0" },
        },
      ]);
      if (!(reply instanceof Message))
        throw new TypeError("Expected SDK reply");
      client.emit("messageCreate", reply);
    });
  return { client, channel, fetch };
}

it("owns an actual SDK slash 429 instead of timing out or later retrying", async () => {
  const { client, fetch } = slashFixture("cooldown");
  const ctx: DaemonContext = {
    bot: null,
    user: client,
    voice: null,
    startedAt: new Date().toISOString(),
    ttlSeconds: 60,
    lastActivity: Date.now(),
  };
  try {
    const url = new URL("http://offline/slash");
    const response = await routeRequest(
      ctx,
      url,
      new Request(url.toString(), {
        method: "POST",
        body: JSON.stringify({
          channelId: "123",
          botId: "999",
          command: "bump",
          args: [],
        }),
      }),
    );
    expect(response.status).toBe(429);
    const result = z
      .object({
        code: z.literal("DISCORD_COOLDOWN"),
        effect: z.literal("not-sent"),
        retryAfterMs: z.number().positive(),
      })
      .parse(await response.json());
    await Bun.sleep(result.retryAfterMs + 25);
    expect(
      fetch.mock.calls.filter(([input]) =>
        z.string().parse(input).endsWith("/interactions"),
      ),
    ).toHaveLength(1);
  } finally {
    client.destroy();
    vi.restoreAllMocks();
  }
});

it("registers the SDK slash reply waiter before a fast accepted response", async () => {
  const { client, channel, fetch } = slashFixture("fast-reply");
  try {
    const reply = await channel.sendSlash("999", "bump");
    expect(reply).toBeInstanceOf(Message);
    expect(reply).toMatchObject({ content: "Bump done" });
    expect(
      fetch.mock.calls.filter(([input]) =>
        z.string().parse(input).endsWith("/interactions"),
      ),
    ).toHaveLength(1);
    expect(client.listenerCount("messageCreate")).toBe(0);
  } finally {
    client.destroy();
    vi.restoreAllMocks();
  }
});

it("propagates an actual SDK 429 and never sends later after caller completion", async () => {
  const client = createDiscordUserClient();
  const fetch = vi.spyOn(client.rest, "fetch").mockImplementation(async () =>
    Response.json(
      { retry_after: 0.8, global: false },
      {
        status: 429,
        headers: {
          "retry-after": "0.8",
          "x-ratelimit-remaining": "1",
          "x-ratelimit-limit": "1",
          "x-ratelimit-reset-after": "0.1",
        },
      },
    ),
  );
  const sdkRequest = z
    .custom<
      (
        method: string,
        path: string,
        options: { auth: false },
      ) => Promise<unknown>
    >((value) => typeof value === "function")
    .parse(Reflect.get(client.rest, "request"));
  const ctx: DaemonContext = {
    bot: null,
    user: null,
    voice: null,
    startedAt: new Date().toISOString(),
    ttlSeconds: 60,
    lastActivity: Date.now(),
  };
  Object.assign(ctx, {
    user: {
      channels: {
        fetch: () =>
          Promise.resolve({
            isText: () => true,
            send: () =>
              sdkRequest.call(client.rest, "post", messagePath, {
                auth: false,
              }),
          }),
      },
    },
  });
  try {
    const url = new URL("http://offline/send");
    const response = await routeRequest(
      ctx,
      url,
      new Request(url.toString(), {
        method: "POST",
        body: JSON.stringify({
          as: "user",
          channelId: "123",
          content: "fixture",
        }),
      }),
    );
    expect(response.status).toBe(429);
    const cooldown = z
      .object({
        code: z.literal("DISCORD_COOLDOWN"),
        effect: z.literal("not-sent"),
        retryAfterMs: z.number().positive(),
        nextEligibleAt: z.iso.datetime(),
      })
      .parse(await response.json());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cooldown.retryAfterMs).toBeGreaterThanOrEqual(800);
    await Bun.sleep(cooldown.retryAfterMs + 25);
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    client.destroy();
    vi.restoreAllMocks();
  }
});
