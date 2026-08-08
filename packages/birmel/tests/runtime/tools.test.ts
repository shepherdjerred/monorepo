import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  BirmelToolMetadataSchema,
  SpecialistIdSchema,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import {
  getRegisteredToolMetadata,
  getToolMetadata,
} from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import {
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { manageMessageTool } from "@shepherdjerred/birmel/agent-tools/tools/discord/messages.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";

const trustedUserId = "186665676134547461";

const expectedMetadata = BirmelToolMetadataSchema.array().parse([
  {
    id: "manage-message",
    specialist: "messaging",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-thread",
    specialist: "messaging",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-poll",
    specialist: "messaging",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "get-activity-stats",
    specialist: "messaging",
    riskClass: "read",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "record-activity",
    specialist: "messaging",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-memory",
    specialist: "messaging",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-agent-session",
    specialist: "messaging",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-guild",
    specialist: "server",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-channel",
    specialist: "server",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-database",
    specialist: "server",
    riskClass: "read",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "moderate-member",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-role",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-member",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-automod-rule",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-webhook",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-invite",
    specialist: "moderation",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-emoji",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-sticker",
    specialist: "moderation",
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "music-playback",
    specialist: "music",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "music-queue",
    specialist: "music",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "music-playlist",
    specialist: "music",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "execute-shell-command",
    specialist: "automation",
    riskClass: "code-execution",
    timeoutMs: 300_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-job",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "browser-automation",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 120_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "external-service",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 120_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "web-research",
    specialist: "automation",
    riskClass: "read",
    timeoutMs: 120_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-scheduled-event",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-election",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "get-candidate-stats",
    specialist: "automation",
    riskClass: "read",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "manage-birthday",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "edit-repo",
    specialist: "editor",
    riskClass: "code-execution",
    timeoutMs: 300_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "list-repos",
    specialist: "editor",
    riskClass: "read",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "get-editor-session",
    specialist: "editor",
    riskClass: "read",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "approve-changes",
    specialist: "editor",
    riskClass: "code-execution",
    timeoutMs: 300_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
  {
    id: "connect-github",
    specialist: "editor",
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
  },
]);

function trustedContext(
  overrides: Partial<RequestContext> = {},
): RequestContext {
  return {
    sourceChannelId: "100000000000000003",
    sourceMessageId: "100000000000000001",
    guildId: "100000000000000002",
    userId: trustedUserId,
    ...overrides,
  };
}

async function executeInContext<T>(
  context: RequestContext,
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  return await runWithRequestContext(context, async () => await operation());
}

describe("tool metadata contracts", () => {
  test("declares the exact specialist, risk, timeout, and request context for every stable tool", () => {
    const actual = getRegisteredToolMetadata().toSorted((left, right) =>
      left.id.localeCompare(right.id),
    );
    const expected = expectedMetadata.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    );

    expect(actual).toEqual(expected);
    expect(new Set(actual.map(({ id }) => id)).size).toBe(actual.length);
  });

  test("registers each tool in exactly one matching specialist set", async () => {
    const toolSets =
      await import("@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts");
    const sets = [
      { specialist: "messaging", tools: toolSets.messagingToolSet },
      { specialist: "server", tools: toolSets.serverToolSet },
      { specialist: "moderation", tools: toolSets.moderationToolSet },
      { specialist: "music", tools: toolSets.musicToolSet },
      { specialist: "automation", tools: toolSets.automationToolSet },
      { specialist: "editor", tools: toolSets.editorToolSet },
    ];
    const registrations = sets.flatMap(({ specialist, tools }) =>
      tools.map((tool) => ({
        id: tool.id,
        specialist: SpecialistIdSchema.parse(specialist),
        metadata: BirmelToolMetadataSchema.parse(tool.birmelMetadata),
      })),
    );

    const registrationCounts = new Map<string, number>();
    for (const { id } of registrations) {
      registrationCounts.set(id, (registrationCounts.get(id) ?? 0) + 1);
    }
    const duplicateIds = [...registrationCounts.entries()]
      .filter(([, count]) => count !== 1)
      .map(([id, count]) => `${id}:${String(count)}`)
      .toSorted();
    const mismatchedAssignments = registrations
      .filter(({ specialist, metadata }) => metadata.specialist !== specialist)
      .map(
        ({ id, specialist, metadata }) =>
          `${id}:${specialist}->${metadata.specialist}`,
      )
      .toSorted();
    const registeredIds = [...registrationCounts.keys()].toSorted();

    expect({
      duplicateIds,
      mismatchedAssignments,
      registeredIds,
    }).toEqual({
      duplicateIds: [],
      mismatchedAssignments: [],
      registeredIds: expectedMetadata.map(({ id }) => id).toSorted(),
    });
  });
});

describe("createTool", () => {
  beforeEach(() => {
    Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
    Bun.env["DISCORD_TOKEN"] = "test-discord-token";
    Bun.env["OPENAI_API_KEY"] = "test-openai-key";
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  test("rejects execution without trusted request context", async () => {
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    await expect(
      Promise.resolve(tool.execute({ guildId: "model-guild" })),
    ).rejects.toThrow("without trusted request context");
  });

  test("rejects an actor outside the trusted allowlist", async () => {
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    await expect(
      executeInContext(trustedContext({ userId: "999999999999999999" }), () =>
        tool.execute({ guildId: "model-guild" }),
      ),
    ).rejects.toThrow("actor is not trusted");
  });

  test("overrides a model-supplied guild with trusted runtime context", async () => {
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.object({ guildId: z.string() }),
      execute: (input) => input,
    });

    const result = await executeInContext(trustedContext(), () =>
      tool.execute({ guildId: "model-controlled-guild" }),
    );

    expect(result.guildId).toBe("100000000000000002");
  });

  test("validates tool results before returning them to the model", async () => {
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.number().positive(),
      execute: () => -1,
    });

    await expect(
      executeInContext(trustedContext(), () =>
        tool.execute({ guildId: "model-guild" }),
      ),
    ).rejects.toThrow();
  });

  test("allows a durable job to reply in its source channel", async () => {
    const channels = getDiscordClient().channels;
    const originalFetch = Reflect.get(channels, "fetch");
    Reflect.set(channels, "fetch", async () => ({
      isSendable: () => true,
      messages: {
        fetch: async () => ({
          reply: async () => ({ id: "400000000000000004" }),
        }),
      },
    }));

    try {
      await expect(
        executeInContext(
          trustedContext({ ownsSourceReply: false }),
          async () =>
            await manageMessageTool.execute({
              action: "reply",
              content: "durable reply",
            }),
        ),
      ).resolves.toMatchObject({ success: true });
    } finally {
      Reflect.set(channels, "fetch", originalFetch);
    }
  });
});

describe("createTool cancellation", () => {
  beforeEach(() => {
    Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
    Bun.env["DISCORD_TOKEN"] = "test-discord-token";
    Bun.env["OPENAI_API_KEY"] = "test-openai-key";
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  test("aborts timed-out work before a later side effect", async () => {
    const metadata = getToolMetadata("manage-guild");
    const originalTimeoutMs = metadata.timeoutMs;
    metadata.timeoutMs = 10;
    let observedSignal: AbortSignal | undefined;
    let sideEffectCount = 0;
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, { signal }) => {
        observedSignal = signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 100);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("operation aborted", { cause: signal.reason }));
            },
            { once: true },
          );
        });
        signal.throwIfAborted();
        sideEffectCount += 1;
        return { ok: true };
      },
    });

    try {
      await expect(
        executeInContext(trustedContext(), () =>
          tool.execute({ guildId: "model-guild" }),
        ),
      ).rejects.toThrow("Tool execution timed out after 10ms");
      await Bun.sleep(120);
      expect(observedSignal?.aborted).toBe(true);
      expect(sideEffectCount).toBe(0);
    } finally {
      metadata.timeoutMs = originalTimeoutMs;
    }
  });

  test("does not release a timed-out tool until signal-ignoring work settles", async () => {
    const metadata = getToolMetadata("manage-guild");
    const originalTimeoutMs = metadata.timeoutMs;
    metadata.timeoutMs = 10;
    const started = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    let sideEffectCount = 0;
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => {
        started.resolve(undefined);
        await release.promise;
        sideEffectCount += 1;
        return { ok: true };
      },
    });

    try {
      const execution = executeInContext(trustedContext(), () =>
        tool.execute({ guildId: "model-guild" }),
      );
      await started.promise;
      const state = await Promise.race([
        execution.then(
          () => "settled",
          () => "settled",
        ),
        Bun.sleep(30).then(() => "pending"),
      ]);
      expect(state).toBe("pending");
      expect(sideEffectCount).toBe(0);

      release.resolve(undefined);
      await expect(execution).rejects.toThrow(
        "Tool execution timed out after 10ms",
      );
      expect(sideEffectCount).toBe(1);
    } finally {
      metadata.timeoutMs = originalTimeoutMs;
      release.resolve(undefined);
    }
  });

  test("propagates an AI SDK caller abort signal", async () => {
    const caller = new AbortController();
    const started = Promise.withResolvers<undefined>();
    let observedSignal: AbortSignal | undefined;
    const tool = createTool({
      id: "manage-guild",
      description: "Test tool",
      inputSchema: z.object({ guildId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (_input, { signal }) => {
        observedSignal = signal;
        started.resolve(undefined);
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("operation aborted", { cause: signal.reason }));
            },
            { once: true },
          );
        });
        return { ok: true };
      },
    });
    const execution = executeInContext(trustedContext(), () =>
      tool.execute({ guildId: "model-guild" }, { abortSignal: caller.signal }),
    );

    await started.promise;
    caller.abort(new Error("caller cancelled"));

    await expect(execution).rejects.toThrow("caller cancelled");
    expect(observedSignal?.aborted).toBe(true);
  });

  test("an already-aborted signal prevents a manage-message Discord write", async () => {
    const channels = getDiscordClient().channels;
    const originalFetch = Reflect.get(channels, "fetch");
    let fetchCount = 0;
    let sendCount = 0;
    Reflect.set(channels, "fetch", async () => {
      fetchCount += 1;
      return {
        isSendable: () => true,
        send: async () => {
          sendCount += 1;
          return { id: "400000000000000001" };
        },
      };
    });
    const caller = new AbortController();
    caller.abort(new Error("cancelled before Discord write"));

    try {
      await expect(
        executeInContext(trustedContext(), () =>
          manageMessageTool.execute(
            {
              action: "send",
              channelId: "400000000000000002",
              content: "must not be sent",
            },
            { abortSignal: caller.signal },
          ),
        ),
      ).rejects.toThrow("cancelled before Discord write");
      expect(fetchCount).toBe(0);
      expect(sendCount).toBe(0);
    } finally {
      Reflect.set(channels, "fetch", originalFetch);
    }
  });
});
