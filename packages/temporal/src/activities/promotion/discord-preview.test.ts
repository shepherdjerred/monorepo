import { afterEach, describe, expect, it, vi } from "vitest";
import { tmpdir } from "node:os";
import path from "node:path";
import { PromotionDiscordPreview } from "./discord-preview.ts";
import { PromotionTaskJournal } from "./publication/task.ts";
import { promotionTarget } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import { readPromotionState, updatePromotionState } from "./store.ts";
import { z } from "zod/v4";
import {
  PromotionTaskResultSchema,
  type PromotionTaskResult,
} from "./publication/task-contract.ts";

const servers: ReturnType<typeof Bun.serve>[] = [];

function blockedResult(): PromotionTaskResult {
  return {
    status: "blocked",
    summary: "Model omitted the cooldown",
    performedAction: false,
    nextEligibleAt: null,
    preparedContent: "Approved The Storm copy",
    evidence: [],
    receipt: null,
  };
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop(true);
});

describe("native write cooldown authority", () => {
  it.each(["blocked", "verified"] as const)(
    "persists a proven initial rejection despite model status %s without allowing another write",
    async (status) => {
      const nextEligibleAt = new Date(Date.now() + 60_000).toISOString();
      const test = harness({
        run: true,
        failure: {
          path: "/send",
          status: 429,
          body: {
            code: "DISCORD_COOLDOWN",
            effect: "not-sent",
            error: "Discord rejected the action due to a cooldown",
            retryAfterMs: 60_000,
            nextEligibleAt,
          },
        },
      });
      await updatePromotionState(test.store, test.target.id, (state) => ({
        ...state,
        lock: { occurrenceId: "fixture", acquiredAt: new Date().toISOString() },
      }));
      expect(
        await test.client.handle({
          endpoint: "discord-send",
          body: { content: "Approved The Storm copy" },
        }),
      ).toMatchObject({ posted: false, status: "cooldown", nextEligibleAt });
      await expect(
        test.client.handle({
          endpoint: "discord-send",
          body: { content: "Approved The Storm copy" },
        }),
      ).rejects.toThrow("One prepared");
      const result = {
        ...blockedResult(),
        status,
        performedAction: status === "verified",
        summary: "Posted successfully",
        evidence: Array.from({ length: 30 }, (_, index) => ({
          url: test.target.url,
          quote: `Model observation ${String(index)}`,
        })),
        receipt:
          status === "verified"
            ? {
                status: "verified" as const,
                url: `${test.target.url}/999`,
                quote: "Model claimed success",
                occurrenceId: null,
              }
            : null,
      };
      test.client.normalizeResult(result);
      expect(() => PromotionTaskResultSchema.parse(result)).not.toThrow();
      expect(result).toMatchObject({
        status: "deferred",
        performedAction: false,
        receipt: null,
        nextEligibleAt,
        summary: `Discord rejected this action due to a cooldown until ${nextEligibleAt}`,
      });
      expect(result.evidence).toEqual([
        {
          url: test.target.url,
          quote: `Discord rejected this action due to a cooldown until ${nextEligibleAt}`,
        },
      ]);
      await test.journal.finish(result);
      const state = await readPromotionState(test.store, test.target.id);
      expect(state.attempts[0]?.status).toBe("no-action");
      expect(Date.parse(state.nextEligibleAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(nextEligibleAt),
      );
      expect(
        test.requests.filter((request) => request.path === "/send"),
      ).toHaveLength(1);
    },
  );

  it.each([
    {
      path: "/read" as const,
      status: 429,
      body: {
        code: "DISCORD_COOLDOWN",
        effect: "not-sent",
        error: "Read limit",
        retryAfterMs: 60_000,
        nextEligibleAt: "2030-01-01T00:00:00Z",
      },
    },
    { path: "/send" as const, status: 500, body: { error: "Connection lost" } },
    {
      path: "/send" as const,
      status: 429,
      body: { error: "Unclassified rejection" },
    },
  ])(
    "retains uncertainty for unproven or post-acceptance errors: %j",
    async (failure) => {
      const test = harness({ run: true, failure });
      await updatePromotionState(test.store, test.target.id, (state) => ({
        ...state,
        lock: { occurrenceId: "fixture", acquiredAt: new Date().toISOString() },
      }));
      await expect(
        test.client.handle({
          endpoint: "discord-send",
          body: { content: "Approved The Storm copy" },
        }),
      ).rejects.toThrow("HTTP");
      const result = blockedResult();
      test.client.normalizeResult(result);
      expect(result.status).toBe("blocked");
      expect(result.nextEligibleAt).toBeNull();
      await test.journal.finish(result);
      const state = await readPromotionState(test.store, test.target.id);
      expect(state.attempts[0]?.status).toBe("uncertain");
      await expect(
        test.client.handle({
          endpoint: "discord-send",
          body: { content: "Approved The Storm copy" },
        }),
      ).rejects.toThrow("One prepared");
      expect(
        test.requests.filter((request) => request.path === "/send"),
      ).toHaveLength(1);
    },
  );
});
function harness(
  options: {
    username?: string;
    mixed?: boolean;
    guildId?: string;
    canSend?: boolean;
    slash?: boolean;
    commandMissing?: boolean;
    canUseApplicationCommands?: boolean;
    run?: boolean;
    canManageMessages?: boolean;
    moderationMfaLevel?: "NONE" | "ELEVATED";
    accountMfaEnabled?: boolean;
    failure?: {
      path: "/send" | "/slash" | "/read";
      status: number;
      body: unknown;
    };
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
      ...(options.slash === true
        ? { slash: { botId: "123", command: "bump", args: [] } }
        : {}),
    },
  };
  const requests: { path: string; body: unknown }[] = [];
  let sentContent = "Existing placement";
  const userId = options.run === true ? "1560536854556839948" : "outreach-user";
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
      if (options.failure?.path === url.pathname)
        return Response.json(options.failure.body, {
          status: options.failure.status,
        });
      if (url.pathname === "/status")
        return Response.json({
          identities: {
            user: {
              id: userId,
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
          canUseApplicationCommands: options.canUseApplicationCommands ?? true,
          canManageServer: false,
          canManageMessages: options.canManageMessages ?? true,
          moderationMfaLevel: options.moderationMfaLevel ?? "NONE",
          accountMfaEnabled: options.accountMfaEnabled ?? true,
          administrator: false,
          memberPermissions: "0",
          slowmodeSeconds: 60,
        });
      if (url.pathname === "/commands")
        return Response.json({
          channelId: target.discord.channelId,
          guildId: target.discord.guildId,
          applications: [{ id: "123", name: "DISBOARD" }],
          application_commands:
            options.commandMissing === true
              ? []
              : [
                  {
                    id: "456",
                    application_id: "123",
                    name: "bump",
                    description: "Bump server",
                    type: 1,
                  },
                ],
        });
      if (url.pathname === "/send") {
        sentContent = z.object({ content: z.string() }).parse(body).content;
        return Response.json({ messageId: "123" });
      }
      if (url.pathname === "/delete-reply")
        return Response.json({ deleted: true, alreadyAbsent: false });
      if (url.pathname === "/read")
        return Response.json({
          messages: [
            {
              id: options.run === true ? "123" : "message",
              channelId: target.discord.channelId,
              authorId: userId,
              authorTag: "the.storm.mc",
              content: sentContent,
              createdAt: new Date().toISOString(),
              embeds: [],
            },
          ],
        });
      return new Response("Unexpected native write", { status: 500 });
    },
  });
  servers.push(server);
  const store = memoryPromotionStore();
  const journal = new PromotionTaskJournal({
    target,
    store,
    occurrenceId: "fixture",
    mode: options.run === true ? "run" : "preview",
    enabled: () => Promise.resolve(options.run === true),
    now: Date.now,
    capture: () => client.capture(),
  });
  const client = new PromotionDiscordPreview({
    approvedMessages: Promise.resolve([
      "Approved The Storm copy",
      "Approved",
      "Duplicate",
      "Again",
      "Replacement",
    ]),
    target,
    socket,
    signal: new AbortController().signal,
    journal,
    maxCalls: 20,
    heartbeat: vi.fn(),
    mode: options.run === true ? "run" : "preview",
    saveEvidence: () => Promise.resolve("fixture-readback.json"),
  });
  return { client, requests, journal, target, store };
}

describe("DISBOARD reply cleanup", () => {
  it("blocks a bump when server-required moderation 2FA is missing", async () => {
    const test = harness({
      run: true,
      slash: true,
      canManageMessages: false,
      moderationMfaLevel: "ELEVATED",
      accountMfaEnabled: false,
    });
    test.target.id = "disboard-native-bump";
    await expect(test.client.inspect()).rejects.toThrow("requires 2FA");
    expect(
      test.requests.some((request) =>
        ["/slash", "/send"].includes(request.path),
      ),
    ).toBe(false);
  });
  it("reads a known receipt directly even after it leaves recent channel history", async () => {
    const test = harness({ run: true });
    await test.client.handle({
      endpoint: "discord-read",
      body: { messageId: "123" },
    });
    expect(test.requests.at(-1)?.body).toEqual({
      channelId: test.target.discord.channelId,
      limit: 20,
      messageId: "123",
    });
    test.client.selectReceipt(`${test.target.url}/123`);
    await test.client.capture();
    expect(test.requests.at(-1)?.body).toEqual({
      channelId: test.target.discord.channelId,
      limit: 30,
      messageId: "123",
    });
    expect(
      test.requests.every(
        (request) =>
          !["/send", "/slash", "/delete-reply"].includes(request.path),
      ),
    ).toBe(true);
  });
  it("blocks DISBOARD before publishing when cleanup permission is absent", async () => {
    const test = harness({ run: true, slash: true, canManageMessages: false });
    test.target.id = "disboard-native-bump";
    await expect(test.client.inspect()).rejects.toThrow("Manage Messages");
    expect(
      test.requests.some((r) => r.path === "/slash" || r.path === "/send"),
    ).toBe(false);
  });
  it("cleans only the selected verified DISBOARD reply, never an ordinary ad", async () => {
    const test = harness({ run: true, slash: true });
    const result: PromotionTaskResult = {
      status: "verified",
      summary: "Bump verified",
      performedAction: true,
      nextEligibleAt: null,
      preparedContent: "/bump",
      evidence: [],
      receipt: {
        status: "verified",
        url: `${test.target.url}/123`,
        quote: "Bump done!",
        occurrenceId: "fixture",
      },
    };
    expect(await test.client.cleanupVerifiedReply(result)).toBeNull();
    test.target.id = "disboard-native-bump";
    if (test.target.discord.slash === undefined)
      throw new Error("Fixture slash missing");
    test.target.discord.slash.botId = z
      .string()
      .parse(promotionTarget("disboard-native-bump").discord?.slash?.botId);
    expect(await test.client.cleanupVerifiedReply(result)).toMatchObject({
      status: "deleted",
    });
    expect(test.requests).toEqual([
      {
        path: "/delete-reply",
        body: {
          guildId: test.target.discord.guildId,
          channelId: test.target.discord.channelId,
          messageId: "123",
          expectedAuthorId: "302050872383242240",
        },
      },
    ]);
  });
  it("never deletes a DISBOARD reply in preview", async () => {
    const test = harness({ slash: true });
    test.target.id = "disboard-native-bump";
    const result: PromotionTaskResult = {
      status: "preview",
      summary: "Prepared",
      performedAction: false,
      nextEligibleAt: null,
      preparedContent: "/bump",
      evidence: [],
      receipt: null,
    };
    expect(await test.client.cleanupVerifiedReply(result)).toBeNull();
    expect(test.requests).toEqual([]);
  });
});
describe("approved copy preflight", () => {
  it("allows exact approved copy to prepare once after a rejected local payload", async () => {
    const test = harness();
    const content = "Approved The Storm copy";
    await expect(
      test.client.handle({
        endpoint: "discord-send",
        body: { content: `${content}\n` },
      }),
    ).rejects.toMatchObject({
      code: "unapproved_payload",
      dispatchState: "not_started",
      retryable: true,
      ref: "approved-messages.json",
      message: expect.stringContaining("JSON.parse"),
    });
    expect(test.client.preparedActions).toHaveLength(0);
    expect(
      test.requests.some((request) =>
        ["/send", "/slash", "/delete-reply"].includes(request.path),
      ),
    ).toBe(false);

    await expect(
      test.client.handle({ endpoint: "discord-send", body: { content } }),
    ).resolves.toMatchObject({
      mode: "preview",
      posted: false,
      prepared: { operation: { kind: "message", content } },
    });
    expect(test.client.preparedActions).toHaveLength(1);
    await expect(
      test.client.handle({ endpoint: "discord-send", body: { content } }),
    ).rejects.toThrow("One prepared");
    expect(
      test.requests.some((request) =>
        ["/send", "/slash", "/delete-reply"].includes(request.path),
      ),
    ).toBe(false);
  });
});
describe("scoped Discord executions", () => {
  it("journals a real-mode fixture send once and independently rereads its receipt", async () => {
    const test = harness({ run: true });
    await updatePromotionState(test.store, test.target.id, (state) => ({
      ...state,
      lock: { occurrenceId: "fixture", acquiredAt: new Date().toISOString() },
    }));
    await test.client.handle({
      endpoint: "discord-send",
      body: { content: "Approved The Storm copy" },
    });
    const page = await test.client.capture();
    expect(page.text).toBe("Approved The Storm copy");
    const resolved = await test.client.resolveReceipt({
      status: "verified",
      url: page.url,
      quote: "A model transcription typo",
      occurrenceId: "fixture",
    });
    expect(resolved.quote).toBe("Approved The Storm copy");
    await test.journal.finish({
      status: "verified",
      summary: "Readback verified",
      performedAction: true,
      nextEligibleAt: null,
      preparedContent: page.text,
      evidence: [],
      receipt: {
        status: "verified",
        url: page.url,
        quote: page.text,
        occurrenceId: "fixture",
      },
    });
    const state = await readPromotionState(test.store, test.target.id);
    expect(state.attempts[0]?.status).toBe("verified");
    await expect(
      test.client.handle({
        endpoint: "discord-send",
        body: { content: "Again" },
      }),
    ).rejects.toThrow("One prepared");
    expect(
      test.requests.filter((request) => request.path === "/send"),
    ).toHaveLength(1);
    expect(
      test.requests.filter((request) => request.path === "/read").length,
    ).toBeGreaterThanOrEqual(2);
  });
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
    const test = harness({ slash: true });
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
  it.each([{ commandMissing: true }, { canUseApplicationCommands: false }])(
    "refuses unavailable commands before recording a preview: %j",
    async (options) => {
      const test = harness({ slash: true, ...options });
      await expect(
        test.client.handle({ endpoint: "discord-status" }),
      ).rejects.toThrow(/not available|does not permit/);
      expect(test.client.preparedActions).toEqual([]);
    },
  );
  it("refuses unassigned slash payloads and message substitutions", async () => {
    const test = harness({ slash: true });
    await expect(
      test.client.handle({
        endpoint: "discord-slash",
        body: { botId: "999", command: "bump", args: [] },
      }),
    ).rejects.toThrow("caller-assigned");
    await expect(
      test.client.handle({
        endpoint: "discord-send",
        body: { content: "Replacement" },
      }),
    ).rejects.toThrow("requires the pinned");
    expect(test.client.preparedActions).toEqual([]);
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
