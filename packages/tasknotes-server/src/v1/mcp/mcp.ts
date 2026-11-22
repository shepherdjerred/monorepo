import type { Context, Hono } from "hono";
import { z } from "zod";
import { dispatchMcpTool } from "./mcp-handlers.ts";
import type { McpExecCtx } from "./mcp-org-handlers.ts";
import { MCP_TOOL_DEFINITIONS } from "./mcp-tools.ts";
import {
  getRequestPrincipal,
  requireScope,
  resolveRequestActorMetadata,
  resolveRequestUserId,
  scopedStoreForRequest,
} from "../request-context.ts";
import type { FacetStore } from "../types.ts";

const JSON_RPC_PARSE_ERROR = -32_700;
const JSON_RPC_INVALID_REQUEST = -32_600;
const JSON_RPC_METHOD_NOT_FOUND = -32_601;
const JSON_RPC_INVALID_PARAMS = -32_602;

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  method: z.string().min(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

const ToolCallParamsSchema = z.object({
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()).default({}),
});

type McpDispatchOutcome =
  | { kind: "http"; response: Response }
  | { kind: "notification" }
  | { kind: "rpc"; payload: Record<string, unknown> };

function invalidRequestPayload(): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: JSON_RPC_INVALID_REQUEST,
      message: "Invalid JSON-RPC 2.0 request",
    },
  };
}

async function handleToolsCall(
  c: Context,
  baseStore: FacetStore,
  rpcId: string | number | null,
  params: Record<string, unknown> | undefined,
): Promise<McpDispatchOutcome> {
  const parsedCall = ToolCallParamsSchema.safeParse(params ?? {});
  if (!parsedCall.success) {
    return {
      kind: "rpc",
      payload: {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: JSON_RPC_INVALID_PARAMS,
          message: "Invalid tools/call parameters",
        },
      },
    };
  }

  const toolDef = MCP_TOOL_DEFINITIONS.find(
    (item) => item.name === parsedCall.data.name,
  );
  if (toolDef === undefined) {
    return {
      kind: "rpc",
      payload: {
        jsonrpc: "2.0",
        id: rpcId,
        error: {
          code: JSON_RPC_INVALID_PARAMS,
          message: `Unknown tool: ${parsedCall.data.name}`,
        },
      },
    };
  }

  const scopeDenied = requireScope(c, toolDef.readOnly ? "read" : "write");
  if (scopeDenied !== null) {
    return { kind: "http", response: scopeDenied };
  }
  const resolvedUser = resolveRequestUserId(c);
  if (!resolvedUser.ok) {
    return { kind: "http", response: resolvedUser.response };
  }
  const metaResult = resolveRequestActorMetadata(c);
  if (!metaResult.ok) {
    return { kind: "http", response: metaResult.response };
  }

  const execCtx: McpExecCtx = {
    store: scopedStoreForRequest(c, baseStore, {
      source: "mcp",
      actorMetadata: metaResult.metadata,
    }),
    userId: resolvedUser.userId,
    principal: getRequestPrincipal(c),
  };

  try {
    const output = await dispatchMcpTool(
      execCtx,
      parsedCall.data.name,
      parsedCall.data.arguments,
    );
    const structuredContent =
      typeof output === "object" && output !== null && !Array.isArray(output)
        ? output
        : { items: output };
    return {
      kind: "rpc",
      payload: {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent,
          isError: false,
        },
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "rpc",
      payload: {
        jsonrpc: "2.0",
        id: rpcId,
        result: {
          content: [{ type: "text", text: message }],
          isError: true,
        },
      },
    };
  }
}

async function dispatchValidatedRpc(
  c: Context,
  baseStore: FacetStore,
  rpc: z.infer<typeof JsonRpcRequestSchema>,
): Promise<McpDispatchOutcome> {
  if (rpc.id === undefined) {
    return { kind: "notification" };
  }

  switch (rpc.method) {
    case "initialize": {
      return {
        kind: "rpc",
        payload: {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: {} },
            serverInfo: { name: "facet", version: "0.1.0" },
            instructions:
              "Call facet_get_workspace first to load project, section, label, and filter IDs plus current task counts. Priorities are P1 (Urgent) through P4 (Normal). All writes are recorded in Facet's audit ledger.",
          },
        },
      };
    }
    case "ping": {
      return {
        kind: "rpc",
        payload: { jsonrpc: "2.0", id: rpc.id, result: {} },
      };
    }
    case "tools/list": {
      const scopeDenied = requireScope(c, "read");
      if (scopeDenied !== null) {
        return { kind: "http", response: scopeDenied };
      }
      return {
        kind: "rpc",
        payload: {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            tools: MCP_TOOL_DEFINITIONS.map((t) => ({
              name: t.name,
              description: t.description,
              annotations: t.annotations,
              inputSchema: t.inputSchema,
            })),
          },
        },
      };
    }
    case "tools/call": {
      return await handleToolsCall(c, baseStore, rpc.id, rpc.params);
    }
    default: {
      return {
        kind: "rpc",
        payload: {
          jsonrpc: "2.0",
          id: rpc.id,
          error: {
            code: JSON_RPC_METHOD_NOT_FOUND,
            message: `Method not found: ${rpc.method}`,
          },
        },
      };
    }
  }
}

async function handleBatchMcp(
  c: Context,
  baseStore: FacetStore,
  items: unknown[],
): Promise<Response> {
  if (items.length === 0) {
    return c.json(invalidRequestPayload(), 400);
  }
  const responses: Record<string, unknown>[] = [];
  for (const item of items) {
    const parsed = JsonRpcRequestSchema.safeParse(item);
    if (!parsed.success) {
      responses.push(invalidRequestPayload());
      continue;
    }
    const outcome = await dispatchValidatedRpc(c, baseStore, parsed.data);
    if (outcome.kind === "http") {
      return outcome.response;
    }
    if (outcome.kind === "rpc") {
      responses.push(outcome.payload);
    }
  }
  return responses.length === 0 ? c.body(null, 202) : c.json(responses);
}

export function mountMcpRoutes(app: Hono, baseStore: FacetStore): void {
  app.get("/api/v1/mcp", (c) =>
    c.json({ error: "Facet MCP uses stateless HTTP POST requests" }, 405, {
      Allow: "POST",
    }),
  );

  app.post("/api/v1/mcp", async (c) => {
    let rawJson: unknown;
    try {
      rawJson = await c.req.json();
    } catch {
      return c.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: JSON_RPC_PARSE_ERROR, message: "Parse error" },
        },
        400,
      );
    }

    if (Array.isArray(rawJson)) {
      return await handleBatchMcp(c, baseStore, rawJson);
    }

    const parsed = JsonRpcRequestSchema.safeParse(rawJson);
    if (!parsed.success) {
      return c.json(invalidRequestPayload(), 400);
    }

    const outcome = await dispatchValidatedRpc(c, baseStore, parsed.data);
    if (outcome.kind === "http") {
      return outcome.response;
    }
    return outcome.kind === "notification"
      ? c.body(null, 202)
      : c.json(outcome.payload);
  });
}
