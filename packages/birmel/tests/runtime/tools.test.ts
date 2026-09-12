import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { BirmelToolMetadataSchema } from "@shepherdjerred/birmel/agent-runtime/contracts.ts";
import { createTool } from "@shepherdjerred/birmel/agent-runtime/tools/create-tool.ts";
import {
  getRegisteredToolMetadata,
  getToolMetadata,
} from "@shepherdjerred/birmel/agent-runtime/tools/tool-metadata.ts";
import { getConfig, resetConfig } from "@shepherdjerred/birmel/config/index.ts";
import {
  runWithRequestContext,
  type RequestContext,
} from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { manageMessageTool } from "@shepherdjerred/birmel/agent-tools/tools/discord/messages.ts";
import { getDiscordClient } from "@shepherdjerred/birmel/discord/client.ts";
import {
  getCapabilityCatalog,
  toolsForTurn,
} from "@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts";

const trustedUserId = "186665676134547461";

const expectedMetadata = BirmelToolMetadataSchema.array().parse([
  {
    id: "manage-message",
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
    riskClass: "write",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
    readActions: ["get-info", "get-owner", "get-audit-logs"],
  },
  {
    id: "manage-channel",
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
    id: "moderate-member",
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
    riskClass: "destructive",
    timeoutMs: 30_000,
    requiredRequestContext: [
      "guildId",
      "channelId",
      "userId",
      "sourceMessageId",
    ],
    readActions: ["list", "get"],
  },
  {
    id: "manage-member",
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
    id: "execute-shell-command",
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
    id: "generate-image",
    specialist: "automation",
    riskClass: "write",
    timeoutMs: 60_000,
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
    ownsSourceReply: true,
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
  test("declares the exact risk, timeout, and request context for every stable tool", () => {
    const actual = getRegisteredToolMetadata().toSorted((left, right) =>
      left.id.localeCompare(right.id),
    );
    const expected = expectedMetadata.toSorted((left, right) =>
      left.id.localeCompare(right.id),
    );

    expect(actual).toEqual(expected);
    expect(new Set(actual.map(({ id }) => id)).size).toBe(actual.length);
  });

  test("registers every tool exactly once in the flat registry", async () => {
    const { registeredTools } =
      await import("@shepherdjerred/birmel/agent-tools/tools/tool-sets.ts");
    const registrations = registeredTools.map((tool) => ({
      id: tool.id,
      metadata: BirmelToolMetadataSchema.parse(tool.birmelMetadata),
    }));

    const registrationCounts = new Map<string, number>();
    for (const { id } of registrations) {
      registrationCounts.set(id, (registrationCounts.get(id) ?? 0) + 1);
    }
    const duplicateIds = [...registrationCounts.entries()]
      .filter(([, count]) => count !== 1)
      .map(([id, count]) => `${id}:${String(count)}`)
      .toSorted();
    const mismatchedIds = registrations
      .filter(({ id, metadata }) => metadata.id !== id)
      .map(({ id, metadata }) => `${id}->${metadata.id}`)
      .toSorted();
    const registeredIds = registrations.map(({ id }) => id).toSorted();

    expect({ duplicateIds, mismatchedIds, registeredIds }).toEqual({
      duplicateIds: [],
      mismatchedIds: [],
      registeredIds: expectedMetadata.map(({ id }) => id).toSorted(),
    });
  });

  test("builds the capability catalog from executable tools without generic SQL", () => {
    const catalog = getCapabilityCatalog();
    const ids = catalog.map(({ id }) => id);

    expect(ids).toContain("get-activity-stats");
    expect(ids).toContain("moderate-member");
    expect(ids).not.toContain("manage-database");
    expect(JSON.stringify(catalog).toLocaleLowerCase()).not.toContain("sql");
    expect(JSON.stringify(catalog).toLocaleLowerCase()).not.toContain(
      "database",
    );
  });

  test("gates generate-image advertising in the capability catalog based on configuration", () => {
    getConfig().imageGeneration.enabled = false;
    expect(getCapabilityCatalog().map(({ id }) => id)).not.toContain(
      "generate-image",
    );

    getConfig().imageGeneration.enabled = true;
    expect(getCapabilityCatalog().map(({ id }) => id)).toContain(
      "generate-image",
    );
  });

  test("omits generate-image from the live tool set when image generation is disabled", () => {
    getConfig().imageGeneration.enabled = false;
    expect(Object.keys(toolsForTurn())).not.toContain("generate-image");

    getConfig().imageGeneration.enabled = true;
    expect(Object.keys(toolsForTurn())).toContain("generate-image");
  });
});

describe("createTool", () => {
  beforeEach(() => {
    Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
    Bun.env["DISCORD_TOKEN"] = "test-discord-token";
    Bun.env["OPENROUTER_API_KEY"] = "test-openrouter-key";
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
    const tool = createTool({
      id: "manage-message",
      description: "Test tool",
      inputSchema: z.object({
        action: z.literal("reply"),
        content: z.string(),
      }),
      outputSchema: z.object({ success: z.boolean() }),
      execute: () => ({ success: true }),
    });

    await expect(
      executeInContext(
        trustedContext({ ownsSourceReply: false }),
        async () => await tool.execute({ action: "reply", content: "later" }),
      ),
    ).resolves.toEqual({ success: true });
  });
});

describe("createTool cancellation", () => {
  beforeEach(() => {
    Bun.env["DISCORD_CLIENT_ID"] = "100000000000000001";
    Bun.env["DISCORD_TOKEN"] = "test-discord-token";
    Bun.env["OPENROUTER_API_KEY"] = "test-openrouter-key";
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
