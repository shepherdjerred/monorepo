import type { Client } from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { AgentChatNotFoundError } from "#lib/agent-chat-client.ts";
import type {
  AgentChatBinding,
  AgentChatCatalogEntry,
  AgentChatTurnResult,
} from "#shared/agent/agent-chat.ts";
import type {
  HttpAgentChatCommand,
  HttpAgentChatTurnReceipt,
  HttpAgentChatTurnStatus,
} from "#shared/agent/agent-chat-http.ts";
import {
  buildAgentChatApiRoutes,
  type AgentChatApiOperations,
} from "./agent-chat-api.ts";
import {
  AgentChatTurnConflictError,
  httpAgentChatCommandFingerprint,
  submitHttpAgentChatCommand,
} from "./agent-chat-turns.ts";

const TOKEN = "test-agent-chat-token";
const NOW = "2026-09-14T22:00:00.000Z";
const EMPTY_CHAT_REQUEST = {
  chatId: "empty-chat",
  title: "Empty chat",
  provider: "codex",
  model: "gpt-5.6-luna",
  source: { kind: "discord", channelId: "channel-1" },
} as const;

const ENTRY: AgentChatCatalogEntry = {
  schemaVersion: 1,
  config: {
    chatId: "chat-existing",
    title: "Existing chat",
    provider: "codex",
    model: "gpt-5.4",
    origin: { kind: "schedule", scheduleId: "daily-review" },
    createdAt: "2026-09-14T20:00:00.000Z",
    maxTurnsPerMessage: 24,
  },
  updatedAt: "2026-09-14T21:00:00.000Z",
  turnCount: 2,
};
const EMPTY_CHAT_ENTRY: AgentChatCatalogEntry = {
  ...ENTRY,
  config: {
    chatId: EMPTY_CHAT_REQUEST.chatId,
    title: EMPTY_CHAT_REQUEST.title,
    provider: EMPTY_CHAT_REQUEST.provider,
    model: EMPTY_CHAT_REQUEST.model,
    origin: EMPTY_CHAT_REQUEST.source,
    createdAt: ENTRY.config.createdAt,
    maxTurnsPerMessage: 24,
  },
};
const COMPLETED_ENTRY: AgentChatCatalogEntry = {
  ...ENTRY,
  updatedAt: NOW,
  turnCount: 3,
};

const TURN: AgentChatTurnResult = {
  turnId: "turn-result",
  turnNumber: 3,
  finalText: "The durable answer.",
  providerSessionId: "provider-session",
  sessionManifestKey: "agent-chats/sessions/chat-existing/manifest.json",
  completedAt: NOW,
  usage: {
    inputTokens: 10,
    cachedInputTokens: 2,
    cacheWriteInputTokens: 0,
    outputTokens: 5,
    reasoningTokens: 1,
  },
};
const RECEIPT: HttpAgentChatTurnReceipt = {
  status: "accepted",
  turnId: "imessage-message-123",
  workflowId: "agent-chat-http/imessage-message-123",
};
const COMPLETED_TURN: HttpAgentChatTurnStatus = {
  status: "completed",
  turnId: RECEIPT.turnId,
  workflowId: RECEIPT.workflowId,
  result: TURN,
};

function fakeClient(): Client {
  const client = Object.create(null);
  client.workflow = Object.create(null);
  return client;
}

function makeOperations(): AgentChatApiOperations {
  return {
    register: vi.fn(async () => ENTRY),
    bind: vi.fn(async () => ENTRY),
    get: vi.fn(async (_client, chatId) =>
      chatId === COMPLETED_ENTRY.config.chatId ? COMPLETED_ENTRY : undefined,
    ),
    list: vi.fn(async () => [ENTRY]),
    resolve: vi.fn(async () => COMPLETED_ENTRY),
    submit: vi.fn(async () => RECEIPT),
    poll: vi.fn(async () => COMPLETED_TURN),
  };
}

function appWith(operations: AgentChatApiOperations) {
  return buildAgentChatApiRoutes(TOKEN, fakeClient(), {
    operations,
    now: () => NOW,
  });
}

function request(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Request {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) {
    headers["authorization"] = `Bearer ${options.token}`;
  }
  return new Request(`http://test${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

describe("submitHttpAgentChatCommand", () => {
  const accepted: HttpAgentChatCommand = {
    kind: "continue",
    chatId: "chat-existing",
    request: {
      turnId: RECEIPT.turnId,
      prompt: "Continue the investigation.",
      submittedAt: "2026-09-14T21:59:00.000Z",
      source: { kind: "imessage", conversationId: "chat123" },
    },
  };

  function clientWithAcceptedCommand(command: HttpAgentChatCommand): Client {
    const client = Object.create(null);
    client.workflow = Object.create(null);
    client.workflow.start = vi.fn(async () => ({
      describe: vi.fn(async () => ({
        memo: {
          agentChatCommandFingerprint: httpAgentChatCommandFingerprint(command),
        },
      })),
    }));
    return client;
  }

  it("accepts a semantic retry with a later server timestamp", async () => {
    const retry: HttpAgentChatCommand = {
      ...accepted,
      request: { ...accepted.request, submittedAt: NOW },
    };

    await expect(
      submitHttpAgentChatCommand(clientWithAcceptedCommand(accepted), retry),
    ).resolves.toEqual(RECEIPT);
  });

  it("rejects reuse of a turn id for another command", async () => {
    const conflicting: HttpAgentChatCommand = {
      ...accepted,
      request: { ...accepted.request, prompt: "A different request." },
    };

    await expect(
      submitHttpAgentChatCommand(
        clientWithAcceptedCommand(accepted),
        conflicting,
      ),
    ).rejects.toBeInstanceOf(AgentChatTurnConflictError);
  });
});

describe("buildAgentChatApiRoutes", () => {
  it("requires the shared bearer token", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(request("/agent-chats"));

    expect(response.status).toBe(401);
    expect(operations.list).not.toHaveBeenCalled();
  });

  it("lists every cataloged chat regardless of origin", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(request("/agent-chats", { token: TOKEN }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ chats: [ENTRY] });
  });

  it("creates and starts an ingress chat through the shared turn path", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: {
          title: "From Messages",
          provider: "claude",
          model: "claude-opus-4-1",
          source: { kind: "imessage", conversationId: "chat123" },
          prompt: "Inspect the homelab.",
          turnId: RECEIPT.turnId,
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
    expect(operations.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "new",
        request: expect.objectContaining({
          turnId: RECEIPT.turnId,
          prompt: "Inspect the homelab.",
        }),
      }),
    );
    expect(await response.json()).toEqual({
      chatId:
        "chat-http-390d9274a759cef6304caee4885239a27f98af3eeb1ccf0a93f72dea9f7cb86b",
      turn: RECEIPT,
    });
  });

  it("creates and binds a chat without starting a turn", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: EMPTY_CHAT_REQUEST,
      }),
    );

    expect(response.status).toBe(201);
    expect(operations.register).toHaveBeenCalledOnce();
    expect(operations.bind).toHaveBeenCalledOnce();
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it("requires a stable chat id when creating a chat without a turn", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: {
          title: "Empty chat",
          provider: "codex",
          model: "gpt-5.6-luna",
          source: { kind: "discord", channelId: "channel-1" },
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
  });

  it("reuses registration and the original binding timestamp on create retries", async () => {
    const operations = makeOperations();
    const existing = EMPTY_CHAT_ENTRY;
    operations.get = vi.fn(async () => existing);
    operations.register = vi.fn(async () => existing);
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: EMPTY_CHAT_REQUEST,
      }),
    );

    expect(response.status).toBe(201);
    expect(operations.register).toHaveBeenCalledWith(
      expect.anything(),
      existing.config,
    );
    expect(await response.json()).toEqual({ chat: existing });
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      EMPTY_CHAT_REQUEST.source,
      EMPTY_CHAT_REQUEST.chatId,
      existing.config.createdAt,
    );
  });
});

describe("prompted chat registration", () => {
  it.each([
    { title: "Another title" },
    { provider: "claude" },
    { model: "another-model" },
    { source: { kind: "imessage", conversationId: "another-conversation" } },
    { maxTurnsPerMessage: 25 },
  ])(
    "rejects prompted chat-ID conflicts before durable submission: %j",
    async (conflict) => {
      const operations = makeOperations();
      operations.get = vi.fn(async () => EMPTY_CHAT_ENTRY);
      const response = await appWith(operations).fetch(
        request("/agent-chats", {
          method: "POST",
          token: TOKEN,
          body: {
            ...EMPTY_CHAT_REQUEST,
            prompt: "Inspect the homelab.",
            turnId: RECEIPT.turnId,
            ...conflict,
          },
        }),
      );
      expect(response.status).toBe(409);
      expect(operations.submit).not.toHaveBeenCalled();
      expect(operations.register).not.toHaveBeenCalled();
      expect(operations.bind).not.toHaveBeenCalled();
    },
  );

  it("preserves the original chat configuration on matching prompted retries", async () => {
    const operations = makeOperations();
    operations.get = vi.fn(async () => EMPTY_CHAT_ENTRY);
    const response = await appWith(operations).fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: {
          ...EMPTY_CHAT_REQUEST,
          prompt: "Inspect the homelab.",
          turnId: RECEIPT.turnId,
        },
      }),
    );
    expect(response.status).toBe(202);
    expect(operations.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "new", config: EMPTY_CHAT_ENTRY.config }),
    );
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
  });

  it("rejects a byte-oversized prompt before catalog side effects", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: {
          title: "Oversized chat",
          provider: "claude",
          model: "claude-opus-5",
          source: { kind: "imessage", conversationId: "chat123" },
          prompt: "界".repeat(100_000),
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it("requires a stable turn id before creating a chat with a prompt", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: {
          title: "From Messages",
          provider: "claude",
          model: "claude-opus-5",
          source: { kind: "imessage", conversationId: "chat123" },
          prompt: "Inspect the homelab.",
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
    expect(operations.submit).not.toHaveBeenCalled();
  });
});

describe("durable agent chat binding retries", () => {
  it("preserves the binding operation timestamp across delayed retries", async () => {
    const operations = makeOperations();
    const bind = vi.fn(
      async (
        _client: Client["workflow"],
        _binding: AgentChatBinding,
        _chatId: string,
        _submittedAt: string,
      ) => ENTRY,
    );
    operations.bind = bind;
    const now = vi.fn(() => "2026-09-15T23:00:00.000Z");
    const app = buildAgentChatApiRoutes(TOKEN, fakeClient(), {
      operations,
      now,
    });
    const bindRequest = () =>
      request("/agent-chats/chat-existing/bindings", {
        method: "POST",
        token: TOKEN,
        body: {
          binding: { kind: "discord", channelId: "channel-1" },
          submittedAt: NOW,
        },
      });
    const first = await app.fetch(bindRequest());
    const retry = await app.fetch(bindRequest());
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(bind).toHaveBeenCalledTimes(2);
    for (const call of bind.mock.calls) {
      expect(call[3]).toBe(NOW);
    }
    expect(now).not.toHaveBeenCalled();
  });

  it("requires a stable timestamp for an explicit binding operation", async () => {
    const operations = makeOperations();
    const response = await appWith(operations).fetch(
      request("/agent-chats/chat-existing/bindings", {
        method: "POST",
        token: TOKEN,
        body: { binding: { kind: "discord", channelId: "channel-1" } },
      }),
    );
    expect(response.status).toBe(400);
    expect(operations.bind).not.toHaveBeenCalled();
  });
});

describe("durable agent chat turns and bindings", () => {
  it("continues a selected scheduled chat from Discord and rebinds it", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chat-turns", {
        method: "POST",
        token: TOKEN,
        body: {
          chatId: "chat-existing",
          source: { kind: "discord", channelId: "channel-1" },
          prompt: "Continue that investigation.",
          turnId: RECEIPT.turnId,
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(operations.get).toHaveBeenCalledWith(
      expect.anything(),
      "chat-existing",
    );
    expect(await response.json()).toEqual({ turn: RECEIPT });
    expect(operations.submit).toHaveBeenCalledWith(expect.anything(), {
      kind: "continue",
      chatId: "chat-existing",
      request: {
        turnId: RECEIPT.turnId,
        prompt: "Continue that investigation.",
        submittedAt: NOW,
        source: { kind: "discord", channelId: "channel-1" },
      },
    });
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: "channel-1" },
      "chat-existing",
      NOW,
    );
    expect(
      vi.mocked(operations.submit).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(operations.bind).mock.invocationCallOrder[0] ?? 0);
  });

  it("rejects an unknown explicit chat before durable submission", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chat-turns", {
        method: "POST",
        token: TOKEN,
        body: {
          chatId: "missing-chat",
          source: { kind: "discord", channelId: "channel-1" },
          prompt: "Continue that investigation.",
          turnId: RECEIPT.turnId,
        },
      }),
    );

    expect(response.status).toBe(404);
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it("requires a stable turn id before accepting a continuation", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chat-turns", {
        method: "POST",
        token: TOKEN,
        body: {
          source: { kind: "imessage", conversationId: "unbound" },
          prompt: "Continue.",
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it("resolves an active binding before durably submitting a continuation", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chat-turns", {
        method: "POST",
        token: TOKEN,
        body: {
          source: { kind: "imessage", conversationId: "active-chat" },
          prompt: "Continue.",
          turnId: RECEIPT.turnId,
        },
      }),
    );

    expect(response.status).toBe(202);
    expect(operations.resolve).toHaveBeenCalledWith(expect.anything(), {
      kind: "imessage",
      conversationId: "active-chat",
    });
    expect(operations.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "continue",
        chatId: COMPLETED_ENTRY.config.chatId,
      }),
    );
    expect(operations.bind).not.toHaveBeenCalled();
  });
});

describe("durable agent chat turn status and direct bindings", () => {
  it("polls a durable turn to completion", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request(`/agent-chat-turns/${RECEIPT.turnId}`, { token: TOKEN }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ turn: COMPLETED_TURN });
    expect(operations.poll).toHaveBeenCalledWith(
      expect.anything(),
      RECEIPT.turnId,
    );
  });

  it("reports a running durable turn as accepted", async () => {
    const operations = makeOperations();
    const runningTurn: HttpAgentChatTurnStatus = {
      status: "running",
      turnId: RECEIPT.turnId,
      workflowId: RECEIPT.workflowId,
    };
    operations.poll = vi.fn(async () => runningTurn);
    const app = appWith(operations);

    const response = await app.fetch(
      request(`/agent-chat-turns/${RECEIPT.turnId}`, { token: TOKEN }),
    );

    expect(response.status).toBe(202);
  });

  it("returns not found for an unknown durable turn", async () => {
    const operations = makeOperations();
    operations.poll = vi.fn(async () =>
      new Map<string, HttpAgentChatTurnStatus>().get("unknown"),
    );
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chat-turns/unknown", { token: TOKEN }),
    );

    expect(response.status).toBe(404);
  });

  it("binds any known chat to the requesting ingress", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats/chat-existing/bindings", {
        method: "POST",
        token: TOKEN,
        body: {
          binding: { kind: "discord", channelId: "channel-1" },
          submittedAt: NOW,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: "channel-1" },
      "chat-existing",
      NOW,
    );
  });

  it("returns not found when binding an unknown chat", async () => {
    const operations = makeOperations();
    operations.bind = vi.fn(async () => {
      throw new AgentChatNotFoundError("missing");
    });
    const app = appWith(operations);

    const response = await app.fetch(
      request("/agent-chats/missing/bindings", {
        method: "POST",
        token: TOKEN,
        body: {
          binding: { kind: "discord", channelId: "channel-1" },
          submittedAt: NOW,
        },
      }),
    );

    expect(response.status).toBe(404);
  });

  it("rejects malformed chat ids before catalog queries or updates", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const lookupResponse = await app.fetch(
      request("/agent-chats/%20bad", { token: TOKEN }),
    );
    const bindingResponse = await app.fetch(
      request("/agent-chats/%20bad/bindings", {
        method: "POST",
        token: TOKEN,
        body: {
          binding: { kind: "discord", channelId: "channel-1" },
          submittedAt: NOW,
        },
      }),
    );

    expect(lookupResponse.status).toBe(400);
    expect(bindingResponse.status).toBe(400);
    expect(operations.get).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
  });
});
