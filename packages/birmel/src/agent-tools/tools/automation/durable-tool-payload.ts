import { parseJsonRecord } from "@shepherdjerred/birmel/utils/errors.ts";
import { getRequestContext } from "@shepherdjerred/birmel/agent-tools/tools/request-context.ts";
import { z } from "zod";

const ToolIdSchema = z.string().min(1);
const ToolInputSchema = z.record(z.string(), z.unknown());
const RegisteredToolSchema = z
  .object({
    id: ToolIdSchema,
    inputSchema: z.instanceof(z.ZodType),
  })
  .loose();

export type ValidatedDurableToolPayload = {
  toolId: string;
  input: Record<string, unknown>;
};

type JobInput = Record<string, unknown> | undefined;

export type AgentJobPayload =
  | { kind: "message"; message: string }
  | { kind: "tool"; toolId: string; input?: JobInput }
  | { kind: "agent"; prompt: string };

type PayloadOptions = {
  payload?: AgentJobPayload | undefined;
  toolId?: string | undefined;
  toolInput?: Record<string, unknown> | undefined;
  message?: string | undefined;
  agentPrompt?: string | undefined;
};

type StoredPayload = {
  payloadKind: string;
  toolId: string | null;
  toolInput: string | null;
};

type AgentJobPayloadData = StoredPayload & {
  message: string | null;
  agentPrompt: string | null;
};

function formatInputError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return `${path.length === 0 ? "input" : path}: ${issue.message}`;
    })
    .join("; ");
}

export async function validateDurableToolPayload(
  untrustedToolId: unknown,
  untrustedInput: unknown,
): Promise<ValidatedDurableToolPayload> {
  const toolId = ToolIdSchema.parse(untrustedToolId);
  if (toolId === "manage-job") {
    throw new Error("manage-job cannot schedule itself as a tool payload");
  }

  // A static import would create tool-sets -> manage-job -> registry. Job
  // validation happens after registration, so load the canonical registry here.
  const { allTools } =
    await import("@shepherdjerred/birmel/agent-tools/tools/index.ts");
  const registered = RegisteredToolSchema.safeParse(allTools[toolId]);
  if (!registered.success || registered.data.id !== toolId) {
    throw new Error(
      `Tool "${toolId}" is missing or no longer registered and cannot be scheduled`,
    );
  }

  const requestContext = getRequestContext();
  if (requestContext == null) {
    throw new Error("Durable tool validation requires trusted request context");
  }
  const rawInput = ToolInputSchema.parse(untrustedInput ?? {});
  const parsedInput = registered.data.inputSchema.safeParse({
    ...rawInput,
    guildId: requestContext.guildId,
  });
  if (!parsedInput.success) {
    throw new Error(
      `Invalid input for tool "${toolId}": ${formatInputError(parsedInput.error)}`,
    );
  }
  const storedInput = ToolInputSchema.safeParse(parsedInput.data);
  if (!storedInput.success) {
    throw new Error(
      `Invalid input for tool "${toolId}": the validated payload must be an object`,
    );
  }
  return { toolId, input: storedInput.data };
}

function createPayload(options: PayloadOptions): AgentJobPayload {
  if (options.payload != null) {
    return options.payload;
  }
  if (options.toolId != null && options.toolId.length > 0) {
    return {
      kind: "tool",
      toolId: options.toolId,
      input: options.toolInput,
    };
  }
  if (options.agentPrompt != null && options.agentPrompt.length > 0) {
    return { kind: "agent", prompt: options.agentPrompt };
  }
  if (options.message != null && options.message.length > 0) {
    return { kind: "message", message: options.message };
  }
  throw new Error("A message, tool, or agent payload is required");
}

async function serializePayload(
  payload: AgentJobPayload,
): Promise<AgentJobPayloadData> {
  switch (payload.kind) {
    case "message":
      return {
        payloadKind: "message",
        message: payload.message,
        toolId: null,
        toolInput: null,
        agentPrompt: null,
      };
    case "tool": {
      const validated = await validateDurableToolPayload(
        payload.toolId,
        payload.input,
      );
      return {
        payloadKind: "tool",
        message: null,
        toolId: validated.toolId,
        toolInput: JSON.stringify(validated.input),
        agentPrompt: null,
      };
    }
    case "agent":
      return {
        payloadKind: "agent",
        message: null,
        toolId: null,
        toolInput: null,
        agentPrompt: payload.prompt,
      };
  }
}

export async function serializeCreatePayload(
  options: PayloadOptions,
): Promise<AgentJobPayloadData> {
  return await serializePayload(createPayload(options));
}

function editedPayload(options: PayloadOptions): AgentJobPayload | null {
  if (options.payload != null) {
    return options.payload;
  }
  if (options.toolId != null) {
    return { kind: "tool", toolId: options.toolId, input: options.toolInput };
  }
  if (options.agentPrompt != null) {
    return { kind: "agent", prompt: options.agentPrompt };
  }
  if (options.message != null) {
    return { kind: "message", message: options.message };
  }
  return null;
}

export async function serializeEditPayload(
  options: PayloadOptions,
  existing: StoredPayload,
): Promise<AgentJobPayloadData | Record<string, never>> {
  const nextPayload = editedPayload(options);
  if (nextPayload == null) {
    if (existing.payloadKind === "tool") {
      return await serializePayload({
        kind: "tool",
        toolId: existing.toolId ?? "",
        input: parseJsonRecord(existing.toolInput ?? "{}"),
      });
    }
    return {};
  }
  return await serializePayload(nextPayload);
}
