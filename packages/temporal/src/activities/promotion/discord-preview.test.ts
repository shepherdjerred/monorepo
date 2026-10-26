import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { PromotionDiscordPreview } from "./discord-preview.ts";
import { PromotionTaskJournal } from "./task.ts";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});
function harness(
  options: {
    username?: string;
    mixed?: boolean;
    guildId?: string;
    canSend?: boolean;
  } = {},
) {
  const target = {
    ...promotionTarget("pmc"),
    id: "discord-fixture",
    account: "discord",
    action: "repost" as const,
    url: "https://discord.com/channels/877714016351453184/1054901030644617327",
    hosts: ["discord.com"],
    discord: {
      guildId: "877714016351453184",
      channelId: "1054901030644617327",
      username: "the.storm.mc",
    },
  };
  const requests: { path: string; body: unknown }[] = [];
  const socket = path.join(
    tmpdir(),
    `promotion-discord-${crypto.randomUUID()}.sock`,
  );
  const server = Bun.serve({
    unix: socket,
    fetch: async (request) => {
      const url = new URL(request.url);
      const body: unknown =
        request.method === "POST" ? await request.json() : null;
      requests.push({ path: url.pathname, body });
      if (url.pathname === "/status")
        return Response.json({
          identities: {
            user: {
              id: "outreach-user",
              tag: options.username ?? "the.storm.mc",
            },
            ...(options.mixed === true ? { bot: { id: "other" } } : {}),
          },
        });
      if (url.pathname === "/channel")
        return Response.json({
          id: target.discord.channelId,
          guildId: options.guildId ?? target.discord.guildId,
          name: "fast-lfg",
          type: "GUILD_TEXT",
          canView: true,
          canSend: options.canSend ?? true,
          slowmodeSeconds: 60,
        });
      if (url.pathname === "/read")
        return Response.json({
          messages: [
            {
              id: "message",
              channelId: target.discord.channelId,
              authorId: "outreach-user",
              authorTag: "the.storm.mc",
              content: "Existing placement",
              createdAt: new Date().toISOString(),
              embeds: [],
            },
          ],
        });
      return new Response("Unexpected native write", { status: 500 });
    },
  });
  servers.push(server);
  const journal = new PromotionTaskJournal({
    target,
    store: memoryPromotionStore(),
    occurrenceId: "fixture",
    mode: "preview",
    enabled: () => Promise.resolve(false),
    now: Date.now,
    capture: () => Promise.reject(new Error("No publication")),
  });
  const client = new PromotionDiscordPreview({
    target,
    socket,
    signal: new AbortController().signal,
    journal,
    maxCalls: 20,
    heartbeat: vi.fn(),
  });
  return { client, requests, journal, target };
}

describe("scoped Discord dry runs", () => {
  it("records the actual message and pinned destination without invoking any publication endpoint", async () => {
    const test = harness();
    await test.client.handle({ endpoint: "discord-read" });
    const result = await test.client.handle({
      endpoint: "discord-send",
      body: { content: "Approved The Storm copy" },
    });
    expect(result).toMatchObject({
      mode: "preview",
      posted: false,
      prepared: {
        guildId: test.target.discord.guildId,
        channelId: test.target.discord.channelId,
        userId: "outreach-user",
        operation: { kind: "message", content: "Approved The Storm copy" },
      },
    });
    expect(test.requests.map((request) => request.path)).toEqual([
      "/status",
      "/channel",
      "/read",
      "/status",
      "/channel",
    ]);
    expect(
      test.journal.observations.some((page) =>
        page.text.includes("Existing placement"),
      ),
    ).toBe(true);
    await expect(
      test.client.handle({
        endpoint: "discord-send",
        body: { content: "Duplicate" },
      }),
    ).rejects.toThrow("One prepared");
  });
  it("records slash arguments without calling slash", async () => {
    const test = harness();
    await test.client.handle({
      endpoint: "discord-slash",
      body: { botId: "123", command: "bump", args: [] },
    });
    expect(test.client.preparedActions[0]?.operation).toEqual({
      kind: "slash",
      botId: "123",
      command: "bump",
      args: [],
    });
    expect(test.requests.every((request) => request.path !== "/slash")).toBe(
      true,
    );
  });
  it.each([{ username: "derrej_" }, { mixed: true }])(
    "refuses the wrong or mixed identity before accessing a channel: %j",
    async (options) => {
      const test = harness(options);
      await expect(
        test.client.handle({ endpoint: "discord-status" }),
      ).rejects.toThrow(/identity|user-only/);
      expect(test.requests.map((request) => request.path)).toEqual(["/status"]);
    },
  );
  it("refuses a foreign guild or channel", async () => {
    const test = harness({ guildId: "unrelated" });
    await expect(
      test.client.handle({ endpoint: "discord-read" }),
    ).rejects.toThrow("outside the assigned");
    expect(test.requests.every((request) => request.path !== "/read")).toBe(
      true,
    );
  });
  it("reports a read-only channel instead of preparing a pretend send", async () => {
    const test = harness({ canSend: false });
    await expect(
      test.client.handle({
        endpoint: "discord-send",
        body: { content: "Approved" },
      }),
    ).rejects.toThrow("read-only");
    expect(test.client.preparedActions).toEqual([]);
  });
  it("does not let model arguments override the account or destination", async () => {
    const test = harness();
    await expect(
      test.client.handle({
        endpoint: "discord-send",
        body: { content: "Approved", channelId: "other" },
      }),
    ).rejects.toThrow();
    expect(test.requests).toEqual([]);
  });
});
