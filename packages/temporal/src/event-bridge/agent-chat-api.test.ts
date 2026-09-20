import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdConflictPolicy,
  type Client,
} from "@temporalio/client";
import { describe, expect, it, vi } from "vitest";
import { AgentChatNotFoundError } from "#lib/agent-chat-client.ts";
import type {
  AgentChatBinding,
  AgentChatBindingUpdate,
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
  activateHttpAgentChatCommand,
  httpAgentChatCommandFingerprint,
  submitHttpAgentChatCommand,
} from "./agent-chat-turns.ts";

const TOKEN = "test-agent-chat-token";
const NOW = "2026-09-14T22:00:00.000Z";
const SUBMITTED_AT = "2026-09-14T21:59:00.000Z";
const SOURCE_SEQUENCE = "123456789012345678";
const EMPTY_CHAT_REQUEST = {
  chatId: "empty-chat",
  title: "Empty chat",
  provider: "codex",
  model: "gpt-5.6-luna",
  source: { kind: "discord", channelId: "channel-1" },
  sourceSequence: SOURCE_SEQUENCE,
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

function fakeClient(
  input: {
    start?: unknown;
    getHandle?: unknown;
  } = {},
): Client {
  const client = Object.create(null);
  client.workflow = Object.create(null);
  if (input.start !== undefined) client.workflow.start = input.start;
  if (input.getHandle !== undefined) {
    client.workflow.getHandle = input.getHandle;
  }
  return client;
}

function makeOperations(): AgentChatApiOperations {
  return {
    register: vi.fn<AgentChatApiOperations["register"]>(
      async (_client, config) => ({
        schemaVersion: 1,
        config,
        updatedAt: config.createdAt,
        turnCount: 0,
      }),
    ),
    bind: vi.fn(async () => ENTRY),
    get: vi.fn(async (_client, chatId) =>
      chatId === COMPLETED_ENTRY.config.chatId ? COMPLETED_ENTRY : undefined,
    ),
    list: vi.fn(async () => [ENTRY]),
    resolve: vi.fn(async () => COMPLETED_ENTRY),
    submit: vi.fn(async () => RECEIPT),
    activate: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    poll: vi.fn(async () => COMPLETED_TURN),
  };
}

function operationsWithConflictingRegistration(): AgentChatApiOperations {
  const operations = makeOperations();
  const conflicting = {
    ...EMPTY_CHAT_ENTRY,
    config: { ...EMPTY_CHAT_ENTRY.config, model: "different-model" },
  };
  operations.get = vi
    .fn<AgentChatApiOperations["get"]>()
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(conflicting);
  operations.register = vi.fn(() =>
    Promise.reject(new Error("owner already exists")),
  );
  return operations;
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

function promptedCreateRequest(
  overrides: Record<string, unknown> = {},
): Request {
  return request("/agent-chats", {
    method: "POST",
    token: TOKEN,
    body: {
      ...EMPTY_CHAT_REQUEST,
      prompt: "Inspect the homelab.",
      turnId: RECEIPT.turnId,
      submittedAt: SUBMITTED_AT,
      sourceSequence: SOURCE_SEQUENCE,
      ...overrides,
    },
  });
}

function explicitContinuationRequest(): Request {
  return request("/agent-chat-turns", {
    method: "POST",
    token: TOKEN,
    body: {
      chatId: "chat-existing",
      source: { kind: "discord", channelId: "channel-1" },
      prompt: "Continue that investigation.",
      turnId: RECEIPT.turnId,
      submittedAt: SUBMITTED_AT,
      sourceSequence: SOURCE_SEQUENCE,
    },
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
      sourceSequence: SOURCE_SEQUENCE,
    },
  };

  function clientWithAcceptedCommand(command: HttpAgentChatCommand): Client {
    const client = Object.create(null);
    client.workflow = Object.create(null);
    client.workflow.start = vi.fn(() =>
      Promise.reject(
        new WorkflowExecutionAlreadyStartedError(
          "already accepted",
          `agent-chat-http/${command.request.turnId}`,
          "httpAgentChatWorkflow",
        ),
      ),
    );
    client.workflow.getHandle = vi.fn(() => ({
      describe: vi.fn(async () => ({
        memo: {
          agentChatCommandFingerprint: httpAgentChatCommandFingerprint(command),
        },
      })),
    }));
    return client;
  }

  it("returns a receipt after a fresh start without another Temporal lookup", async () => {
    const describeWorkflow = vi.fn(() =>
      Promise.reject(new Error("lookup outage")),
    );
    const start = vi.fn(async () => ({ describe: describeWorkflow }));
    const client = fakeClient({ start });

    await expect(
      submitHttpAgentChatCommand(client, accepted),
    ).resolves.toMatchObject({ status: "accepted", turnId: RECEIPT.turnId });
    expect(describeWorkflow).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(
      "httpAgentChatWorkflow",
      expect.objectContaining({
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
      }),
    );
  });

  it("rejects a retry that changes the caller timestamp", async () => {
    const retry: HttpAgentChatCommand = {
      ...accepted,
      request: { ...accepted.request, submittedAt: NOW },
    };

    await expect(
      submitHttpAgentChatCommand(clientWithAcceptedCommand(accepted), retry),
    ).rejects.toBeInstanceOf(AgentChatTurnConflictError);
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

  it("rejects a retry that changes the source sequence", async () => {
    const retry: HttpAgentChatCommand = {
      ...accepted,
      request: { ...accepted.request, sourceSequence: "123456789012345679" },
    };

    await expect(
      submitHttpAgentChatCommand(clientWithAcceptedCommand(accepted), retry),
    ).rejects.toBeInstanceOf(AgentChatTurnConflictError);
  });

  it("reconciles an ambiguous activation with the same update id", async () => {
    const executeUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(null);
    const client = fakeClient({
      getHandle: vi.fn(() => ({ executeUpdate })),
    });

    await expect(
      activateHttpAgentChatCommand(client, accepted),
    ).resolves.toBeUndefined();
    expect(executeUpdate).toHaveBeenCalledTimes(2);
    expect(executeUpdate.mock.calls[0]?.[1]).toMatchObject({
      updateId: "activate",
    });
    expect(executeUpdate.mock.calls[1]?.[1]).toMatchObject({
      updateId: "activate",
    });
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
      promptedCreateRequest({
        chatId: undefined,
        title: "From Messages",
        provider: "claude",
        model: "claude-opus-4-1",
        source: { kind: "imessage", conversationId: "chat123" },
      }),
    );

    expect(response.status).toBe(202);
    expect(operations.register).toHaveBeenCalledOnce();
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "imessage", conversationId: "chat123" },
      expect.stringMatching(/^chat-http-/),
      { updatedAt: SUBMITTED_AT, sourceSequence: SOURCE_SEQUENCE },
    );
    expect(operations.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "new",
        request: expect.objectContaining({
          turnId: RECEIPT.turnId,
          prompt: "Inspect the homelab.",
        }),
      }),
      { waitForActivation: true },
    );
    expect(
      vi.mocked(operations.submit).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(operations.register).mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      vi.mocked(operations.register).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(operations.activate).mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      vi.mocked(operations.activate).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(operations.bind).mock.invocationCallOrder[0] ?? 0);
    expect(await response.json()).toEqual({
      chatId:
        "chat-http-390d9274a759cef6304caee4885239a27f98af3eeb1ccf0a93f72dea9f7cb86b",
      turn: RECEIPT,
    });
  });

  it("acknowledges an activated chat when its binding checkpoint fails", async () => {
    const operations = makeOperations();
    operations.bind = vi.fn(() =>
      Promise.reject(new Error("catalog unavailable")),
    );
    const app = appWith(operations);

    const response = await app.fetch(
      promptedCreateRequest({
        chatId: undefined,
        title: "From Messages",
        provider: "claude",
        model: "claude-opus-4-1",
        source: { kind: "imessage", conversationId: "chat123" },
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      chatId:
        "chat-http-390d9274a759cef6304caee4885239a27f98af3eeb1ccf0a93f72dea9f7cb86b",
      turn: RECEIPT,
    });
    expect(operations.activate).toHaveBeenCalledOnce();
    expect(operations.bind).toHaveBeenCalledOnce();
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
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      EMPTY_CHAT_REQUEST.source,
      EMPTY_CHAT_REQUEST.chatId,
      {
        updatedAt: expect.any(String),
        sourceSequence: SOURCE_SEQUENCE,
      },
    );
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
      {
        updatedAt: existing.config.createdAt,
        sourceSequence: SOURCE_SEQUENCE,
      },
    );
  });

  it("returns a conflict when another request races registration", async () => {
    const operations = operationsWithConflictingRegistration();

    const response = await appWith(operations).fetch(
      request("/agent-chats", {
        method: "POST",
        token: TOKEN,
        body: EMPTY_CHAT_REQUEST,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.text()).toContain(
      "reused with different configuration",
    );
    expect(operations.bind).not.toHaveBeenCalled();
  });
});

describe("prompted chat registration", () => {
  it("adopts a matching raced owner before activating the claimed turn", async () => {
    const operations = makeOperations();
    const raced = {
      ...EMPTY_CHAT_ENTRY,
      config: {
        ...EMPTY_CHAT_ENTRY.config,
        createdAt: "2026-09-14T20:00:00.000Z",
      },
    };
    operations.get = vi
      .fn<AgentChatApiOperations["get"]>()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(raced);
    operations.register = vi.fn(() =>
      Promise.reject(new Error("owner already exists")),
    );

    const response = await appWith(operations).fetch(promptedCreateRequest());

    expect(response.status).toBe(202);
    expect(operations.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "new" }),
      { waitForActivation: true },
    );
    expect(operations.activate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "new", config: raced.config }),
    );
  });

  it("rejects a reused turn ID before registering a fresh chat", async () => {
    const operations = makeOperations();
    operations.submit = vi.fn(() =>
      Promise.reject(new AgentChatTurnConflictError(RECEIPT.turnId)),
    );

    const response = await appWith(operations).fetch(promptedCreateRequest());

    expect(response.status).toBe(409);
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.activate).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
  });

  it("cancels a deferred turn when raced registration conflicts", async () => {
    const operations = operationsWithConflictingRegistration();

    const response = await appWith(operations).fetch(promptedCreateRequest());

    expect(response.status).toBe(409);
    expect(operations.submit).toHaveBeenCalledOnce();
    expect(operations.cancel).toHaveBeenCalledWith(
      expect.anything(),
      RECEIPT.turnId,
    );
    expect(operations.activate).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
  });

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
        promptedCreateRequest(conflict),
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
    const response = await appWith(operations).fetch(promptedCreateRequest());
    expect(response.status).toBe(202);
    expect(operations.submit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ kind: "new", config: EMPTY_CHAT_ENTRY.config }),
      { waitForActivation: true },
    );
    expect(operations.register).toHaveBeenCalledWith(
      expect.anything(),
      EMPTY_CHAT_ENTRY.config,
    );
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      EMPTY_CHAT_REQUEST.source,
      EMPTY_CHAT_REQUEST.chatId,
      { updatedAt: SUBMITTED_AT, sourceSequence: SOURCE_SEQUENCE },
    );
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
          submittedAt: SUBMITTED_AT,
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(operations.register).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it("requires a caller-stable timestamp for a prompted create", async () => {
    const operations = makeOperations();
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
    expect(response.status).toBe(400);
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
        _update: AgentChatBindingUpdate,
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
          bindingId: "binding-1",
          submittedAt: NOW,
          sourceSequence: SOURCE_SEQUENCE,
        },
      });
    const first = await app.fetch(bindRequest());
    const retry = await app.fetch(bindRequest());
    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(bind).toHaveBeenCalledTimes(2);
    for (const call of bind.mock.calls) {
      expect(call[3]).toEqual({
        updatedAt: NOW,
        sourceSequence: SOURCE_SEQUENCE,
      });
    }
    expect(now).toHaveBeenCalledTimes(2);
  });

  it("requires a stable identity for an explicit binding operation", async () => {
    const operations = makeOperations();
    const response = await appWith(operations).fetch(
      request("/agent-chats/chat-existing/bindings", {
        method: "POST",
        token: TOKEN,
        body: {
          binding: { kind: "discord", channelId: "channel-1" },
          submittedAt: NOW,
        },
      }),
    );
    expect(response.status).toBe(400);
    expect(operations.bind).not.toHaveBeenCalled();
  });

  it("rejects a binding timestamp beyond the allowed clock skew", async () => {
    const operations = makeOperations();
    const response = await appWith(operations).fetch(
      request("/agent-chats/chat-existing/bindings", {
        method: "POST",
        token: TOKEN,
        body: {
          binding: { kind: "discord", channelId: "channel-1" },
          bindingId: "future-binding",
          submittedAt: "2099-01-01T00:00:00.000Z",
          sourceSequence: SOURCE_SEQUENCE,
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "submittedAt is too far in the future",
    });
    expect(operations.bind).not.toHaveBeenCalled();
  });
});

describe("durable agent chat turns and bindings", () => {
  it("continues a selected scheduled chat from Discord and rebinds it", async () => {
    const operations = makeOperations();
    const app = appWith(operations);

    const response = await app.fetch(explicitContinuationRequest());

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
        submittedAt: SUBMITTED_AT,
        sourceSequence: SOURCE_SEQUENCE,
        source: { kind: "discord", channelId: "channel-1" },
      },
    });
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: "channel-1" },
      "chat-existing",
      { updatedAt: SUBMITTED_AT, sourceSequence: SOURCE_SEQUENCE },
    );
    expect(
      vi.mocked(operations.submit).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(operations.bind).mock.invocationCallOrder[0] ?? 0);
  });

  it("acknowledges a submitted continuation when rebinding fails", async () => {
    const operations = makeOperations();
    operations.bind = vi.fn(() =>
      Promise.reject(new Error("catalog unavailable")),
    );
    const app = appWith(operations);

    const response = await app.fetch(explicitContinuationRequest());

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ turn: RECEIPT });
    expect(operations.submit).toHaveBeenCalledOnce();
    expect(operations.bind).toHaveBeenCalledOnce();
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
          submittedAt: SUBMITTED_AT,
          sourceSequence: SOURCE_SEQUENCE,
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
          submittedAt: SUBMITTED_AT,
        },
      }),
    );

    expect(response.status).toBe(400);
    expect(operations.submit).not.toHaveBeenCalled();
  });

  it("requires a caller-stable timestamp before accepting a continuation", async () => {
    const operations = makeOperations();
    const response = await appWith(operations).fetch(
      request("/agent-chat-turns", {
        method: "POST",
        token: TOKEN,
        body: {
          source: { kind: "imessage", conversationId: "unbound" },
          prompt: "Continue.",
          turnId: RECEIPT.turnId,
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
          submittedAt: SUBMITTED_AT,
          sourceSequence: SOURCE_SEQUENCE,
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
          bindingId: "binding-2",
          submittedAt: NOW,
          sourceSequence: SOURCE_SEQUENCE,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(operations.bind).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "discord", channelId: "channel-1" },
      "chat-existing",
      { updatedAt: NOW, sourceSequence: SOURCE_SEQUENCE },
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
          bindingId: "missing-chat-binding",
          submittedAt: NOW,
          sourceSequence: SOURCE_SEQUENCE,
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
          bindingId: "bad-chat-binding",
          submittedAt: NOW,
          sourceSequence: SOURCE_SEQUENCE,
        },
      }),
    );

    expect(lookupResponse.status).toBe(400);
    expect(bindingResponse.status).toBe(400);
    expect(operations.get).not.toHaveBeenCalled();
    expect(operations.bind).not.toHaveBeenCalled();
  });
});
