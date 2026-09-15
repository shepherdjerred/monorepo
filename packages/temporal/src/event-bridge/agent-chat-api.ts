import type { Client, WorkflowClient } from "@temporalio/client";
import * as Sentry from "@sentry/bun";
import { Hono } from "hono";
import { z, ZodError } from "zod/v4";
import {
  AgentChatBindingNotFoundError,
  AgentChatNotFoundError,
  bindAgentChat,
  getAgentChat,
  listAgentChats,
  registerAgentChat,
  resolveAgentChatBinding,
} from "#lib/agent-chat-client.ts";
import {
  AgentChatBindingSchema,
  AgentChatIdSchema,
  AgentChatPromptSchema,
  AgentChatProviderSchema,
  type AgentChatBinding,
  type AgentChatCatalogEntry,
  type AgentChatConfig,
  type AgentChatTurnRequest,
} from "#shared/agent/agent-chat.ts";
import {
  HttpAgentChatCommandSchema,
  HttpAgentChatTurnIdSchema,
  type HttpAgentChatCommand,
  type HttpAgentChatTurnReceipt,
  type HttpAgentChatTurnStatus,
} from "#shared/agent/agent-chat-http.ts";
import {
  AgentChatTurnConflictError,
  pollHttpAgentChatCommand,
  submitHttpAgentChatCommand,
} from "./agent-chat-turns.ts";
import { bearerMatches, bearerToken } from "./http-auth.ts";

const COMPONENT = "agent-chat-api";

const CreateAgentChatSchema = z
  .strictObject({
    chatId: AgentChatIdSchema.optional(),
    title: z.string().min(1).max(200),
    provider: AgentChatProviderSchema,
    model: z.string().min(1).max(200),
    source: AgentChatBindingSchema,
    prompt: AgentChatPromptSchema.optional(),
    turnId: HttpAgentChatTurnIdSchema.optional(),
    maxTurnsPerMessage: z.number().int().positive().max(100).default(24),
  })
  .refine((input) => input.prompt === undefined || input.turnId !== undefined, {
    message: "turnId is required when prompt is present",
    path: ["turnId"],
  })
  .refine((input) => input.prompt !== undefined || input.chatId !== undefined, {
    message: "chatId is required when prompt is absent",
    path: ["chatId"],
  });

const ContinueAgentChatSchema = z.strictObject({
  source: AgentChatBindingSchema,
  prompt: AgentChatPromptSchema,
  chatId: AgentChatIdSchema.optional(),
  turnId: HttpAgentChatTurnIdSchema,
});
type ContinueAgentChatInput = z.infer<typeof ContinueAgentChatSchema>;

const BindAgentChatSchema = z.strictObject({
  binding: AgentChatBindingSchema,
  submittedAt: z.iso.datetime({ offset: true }),
});

export type AgentChatApiOperations = {
  register: (
    client: WorkflowClient,
    config: AgentChatConfig,
  ) => Promise<AgentChatCatalogEntry>;
  bind: (
    client: WorkflowClient,
    binding: AgentChatBinding,
    chatId: string,
    updatedAt: string,
  ) => Promise<AgentChatCatalogEntry>;
  get: (
    client: WorkflowClient,
    chatId: string,
  ) => Promise<AgentChatCatalogEntry | undefined>;
  list: (client: WorkflowClient) => Promise<AgentChatCatalogEntry[]>;
  resolve: (
    client: WorkflowClient,
    binding: AgentChatBinding,
  ) => Promise<AgentChatCatalogEntry | undefined>;
  submit: (
    client: Client,
    command: HttpAgentChatCommand,
  ) => Promise<HttpAgentChatTurnReceipt>;
  poll: (
    client: Client,
    turnId: string,
  ) => Promise<HttpAgentChatTurnStatus | undefined>;
};

class AgentChatRegistrationConflictError extends Error {
  public constructor(chatId: string) {
    super(
      `Durable agent chat ID ${chatId} was reused with different configuration`,
    );
    this.name = "AgentChatRegistrationConflictError";
  }
}

const defaultOperations: AgentChatApiOperations = {
  register: registerAgentChat,
  bind: bindAgentChat,
  get: getAgentChat,
  list: listAgentChats,
  resolve: resolveAgentChatBinding,
  submit: submitHttpAgentChatCommand,
  poll: pollHttpAgentChatCommand,
};

type AgentChatApiDependencies = {
  operations?: AgentChatApiOperations;
  now?: () => string;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({ level, msg: message, component: COMPONENT, ...fields }),
  );
}

function unauthorized(authorization: string | undefined, token: string) {
  return !bearerMatches(bearerToken(authorization), token);
}

async function parseBody(request: Request): Promise<unknown> {
  return await request.json();
}

function configForIngress(
  input: {
    chatId?: string | undefined;
    turnId?: string | undefined;
    title: string;
    provider: "claude" | "codex";
    model: string;
    source: AgentChatBinding;
    maxTurnsPerMessage: number;
  },
  now: string,
): AgentChatConfig {
  const chatId =
    input.chatId ??
    (input.turnId === undefined
      ? undefined
      : `chat-http-${new Bun.CryptoHasher("sha256").update(input.turnId).digest("hex")}`);
  if (chatId === undefined) {
    throw new TypeError(
      "Agent chat creation requires a stable chat or turn ID",
    );
  }
  return {
    chatId,
    title: input.title,
    provider: input.provider,
    model: input.model,
    origin: input.source,
    createdAt: now,
    maxTurnsPerMessage: input.maxTurnsPerMessage,
  };
}

function requestedConfigMatches(
  existing: AgentChatConfig,
  requested: AgentChatConfig,
): boolean {
  return (
    existing.chatId === requested.chatId &&
    existing.title === requested.title &&
    existing.provider === requested.provider &&
    existing.model === requested.model &&
    JSON.stringify(existing.origin) === JSON.stringify(requested.origin) &&
    existing.maxTurnsPerMessage === requested.maxTurnsPerMessage
  );
}

async function findMatchingRegistration(
  operations: AgentChatApiOperations,
  client: WorkflowClient,
  config: AgentChatConfig,
): Promise<AgentChatCatalogEntry | undefined> {
  const existing = await operations.get(client, config.chatId);
  if (existing !== undefined) {
    if (!requestedConfigMatches(existing.config, config)) {
      throw new AgentChatRegistrationConflictError(config.chatId);
    }
    return existing;
  }
  return undefined;
}

async function registerIdempotently(
  operations: AgentChatApiOperations,
  client: WorkflowClient,
  config: AgentChatConfig,
): Promise<AgentChatCatalogEntry> {
  const existing = await findMatchingRegistration(operations, client, config);
  if (existing !== undefined) return existing;
  try {
    return await operations.register(client, config);
  } catch (error: unknown) {
    const raced = await operations.get(client, config.chatId);
    if (raced === undefined || !requestedConfigMatches(raced.config, config)) {
      throw error;
    }
    return raced;
  }
}

function requestForIngress(
  input: {
    source: AgentChatBinding;
    prompt: string;
    turnId: string;
  },
  now: string,
): AgentChatTurnRequest {
  return {
    turnId: input.turnId,
    prompt: input.prompt,
    submittedAt: now,
    source: input.source,
  };
}

async function resolveIngressChatId(
  operations: AgentChatApiOperations,
  client: WorkflowClient,
  input: ContinueAgentChatInput,
): Promise<string> {
  if (input.chatId !== undefined) {
    const explicit = await operations.get(client, input.chatId);
    if (explicit === undefined) throw new AgentChatNotFoundError(input.chatId);
    return explicit.config.chatId;
  }
  const resolved = await operations.resolve(client, input.source);
  if (resolved === undefined) throw new AgentChatBindingNotFoundError();
  return resolved.config.chatId;
}

function captureFailure(error: unknown, operation: string): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    scope.setTag("operation", operation);
    Sentry.captureException(error);
  });
  jsonLog("error", "Durable agent chat API operation failed", {
    operation,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function buildAgentChatApiRoutes(
  token: string,
  client: Client,
  dependencies: AgentChatApiDependencies = {},
): Hono {
  const app = new Hono();
  const operations = dependencies.operations ?? defaultOperations;
  const now = dependencies.now ?? (() => new Date().toISOString());

  app.get("/agent-chats", async (c) => {
    if (unauthorized(c.req.header("authorization"), token)) {
      return c.text("unauthorized\n", 401);
    }
    try {
      return c.json({ chats: await operations.list(client.workflow) });
    } catch (error: unknown) {
      captureFailure(error, "list");
      return c.text("list failed\n", 500);
    }
  });

  app.get("/agent-chats/:chatId", async (c) => {
    if (unauthorized(c.req.header("authorization"), token)) {
      return c.text("unauthorized\n", 401);
    }
    try {
      const chatId = AgentChatIdSchema.parse(c.req.param("chatId"));
      const entry = await operations.get(client.workflow, chatId);
      return entry === undefined
        ? c.text("chat not found\n", 404)
        : c.json(entry);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return c.json({ error: "bad chat id", issues: error.issues }, 400);
      }
      captureFailure(error, "get");
      return c.text("lookup failed\n", 500);
    }
  });

  app.post("/agent-chats", async (c) => {
    if (unauthorized(c.req.header("authorization"), token)) {
      return c.text("unauthorized\n", 401);
    }
    try {
      const input = CreateAgentChatSchema.parse(await parseBody(c.req.raw));
      const timestamp = now();
      const config = configForIngress(input, timestamp);
      if (input.prompt === undefined) {
        const entry = await registerIdempotently(
          operations,
          client.workflow,
          config,
        );
        await operations.bind(
          client.workflow,
          input.source,
          config.chatId,
          entry.config.createdAt,
        );
        return c.json({ chat: entry }, 201);
      }
      const turnId = HttpAgentChatTurnIdSchema.parse(input.turnId);
      const existing = await findMatchingRegistration(
        operations,
        client.workflow,
        config,
      );
      const receipt = await operations.submit(
        client,
        HttpAgentChatCommandSchema.parse({
          kind: "new",
          config: existing?.config ?? config,
          request: requestForIngress(
            { source: input.source, prompt: input.prompt, turnId },
            timestamp,
          ),
        }),
      );
      return c.json({ chatId: config.chatId, turn: receipt }, 202);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return c.text("bad json\n", 400);
      if (error instanceof ZodError) {
        return c.json({ error: "bad payload", issues: error.issues }, 400);
      }
      if (error instanceof AgentChatTurnConflictError) {
        return c.text(`${error.message}\n`, 409);
      }
      if (error instanceof AgentChatRegistrationConflictError) {
        return c.text(`${error.message}\n`, 409);
      }
      captureFailure(error, "create");
      return c.text("create failed\n", 500);
    }
  });

  app.post("/agent-chat-turns", async (c) => {
    if (unauthorized(c.req.header("authorization"), token)) {
      return c.text("unauthorized\n", 401);
    }
    try {
      const input = ContinueAgentChatSchema.parse(await parseBody(c.req.raw));
      const chatId = await resolveIngressChatId(
        operations,
        client.workflow,
        input,
      );
      const receipt = await operations.submit(
        client,
        HttpAgentChatCommandSchema.parse({
          kind: "continue",
          chatId,
          request: requestForIngress(input, now()),
        }),
      );
      return c.json({ turn: receipt }, 202);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return c.text("bad json\n", 400);
      if (error instanceof ZodError) {
        return c.json({ error: "bad payload", issues: error.issues }, 400);
      }
      if (error instanceof AgentChatBindingNotFoundError) {
        return c.text(`${error.message}\n`, 404);
      }
      if (error instanceof AgentChatNotFoundError) {
        return c.text(`${error.message}\n`, 404);
      }
      if (error instanceof AgentChatTurnConflictError) {
        return c.text(`${error.message}\n`, 409);
      }
      captureFailure(error, "continue");
      return c.text("turn failed\n", 500);
    }
  });

  app.get("/agent-chat-turns/:turnId", async (c) => {
    if (unauthorized(c.req.header("authorization"), token)) {
      return c.text("unauthorized\n", 401);
    }
    try {
      const turnId = HttpAgentChatTurnIdSchema.parse(c.req.param("turnId"));
      const status = await operations.poll(client, turnId);
      if (status === undefined) return c.text("turn not found\n", 404);
      return c.json({ turn: status }, status.status === "running" ? 202 : 200);
    } catch (error: unknown) {
      if (error instanceof ZodError) {
        return c.json({ error: "bad turn id", issues: error.issues }, 400);
      }
      captureFailure(error, "poll");
      return c.text("turn lookup failed\n", 500);
    }
  });

  app.post("/agent-chats/:chatId/bindings", async (c) => {
    if (unauthorized(c.req.header("authorization"), token)) {
      return c.text("unauthorized\n", 401);
    }
    try {
      const chatId = AgentChatIdSchema.parse(c.req.param("chatId"));
      const input = BindAgentChatSchema.parse(await parseBody(c.req.raw));
      const entry = await operations.bind(
        client.workflow,
        input.binding,
        chatId,
        input.submittedAt,
      );
      return c.json(entry);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return c.text("bad json\n", 400);
      if (error instanceof ZodError) {
        return c.json({ error: "bad payload", issues: error.issues }, 400);
      }
      if (error instanceof AgentChatNotFoundError) {
        return c.text(`${error.message}\n`, 404);
      }
      captureFailure(error, "bind");
      return c.text("bind failed\n", 500);
    }
  });

  return app;
}
