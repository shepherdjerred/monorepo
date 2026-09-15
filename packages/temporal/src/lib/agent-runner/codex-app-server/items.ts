import type { ThreadEvent, ThreadItem } from "@openai/codex-sdk";
import { z } from "zod/v4";

const HeaderSchema = z.object({ id: z.string(), type: z.string() });
const StatusSchema = z.enum(["inProgress", "completed", "failed", "declined"]);

export function appServerItemKind(value: unknown): string {
  return HeaderSchema.parse(value).type;
}

export function isEffectfulItemKind(kind: string): boolean {
  return ["commandExecution", "fileChange", "mcpToolCall"].includes(kind);
}

function normalizedStatus(status: z.infer<typeof StatusSchema>) {
  if (status === "inProgress") return "in_progress";
  return status === "declined" ? "failed" : status;
}

function commandItem(value: unknown): ThreadItem {
  const item = HeaderSchema.extend({
    command: z.string(),
    aggregatedOutput: z.string().nullable(),
    exitCode: z.number().int().nullable(),
    status: StatusSchema,
  }).parse(value);
  return {
    id: item.id,
    type: "command_execution",
    command: item.command,
    aggregated_output: item.aggregatedOutput ?? "",
    ...(item.exitCode === null ? {} : { exit_code: item.exitCode }),
    status: normalizedStatus(item.status),
  };
}

function fileItem(value: unknown): ThreadItem | undefined {
  const item = HeaderSchema.extend({
    changes: z.array(
      z.object({
        path: z.string(),
        kind: z.object({ type: z.enum(["add", "delete", "update"]) }),
      }),
    ),
    status: StatusSchema,
  }).parse(value);
  if (item.status === "inProgress") return undefined;
  return {
    id: item.id,
    type: "file_change",
    changes: item.changes.map((change) => ({
      path: change.path,
      kind: change.kind.type,
    })),
    status: item.status === "declined" ? "failed" : item.status,
  };
}

function mcpItem(value: unknown): ThreadItem {
  const item = HeaderSchema.extend({
    server: z.string(),
    tool: z.string(),
    arguments: z.unknown(),
    status: StatusSchema,
  }).parse(value);
  return {
    id: item.id,
    type: "mcp_tool_call",
    server: item.server,
    tool: item.tool,
    arguments: item.arguments,
    status: normalizedStatus(item.status),
  };
}

function normalizedItem(value: unknown): ThreadItem | undefined {
  const header = HeaderSchema.parse(value);
  switch (header.type) {
    case "agentMessage": {
      const item = HeaderSchema.extend({
        text: z.string(),
        phase: z.enum(["commentary", "final_answer"]).nullable(),
      }).parse(value);
      return item.phase === "commentary"
        ? undefined
        : { id: item.id, type: "agent_message", text: item.text };
    }
    case "commandExecution":
      return commandItem(value);
    case "fileChange":
      return fileItem(value);
    case "mcpToolCall":
      return mcpItem(value);
    case "webSearch": {
      const item = HeaderSchema.extend({ query: z.string() }).parse(value);
      return { id: item.id, type: "web_search", query: item.query };
    }
    case "userMessage":
    case "hookPrompt":
    case "reasoning":
    case "plan":
    case "contextCompaction":
    case "imageView":
    case "enteredReviewMode":
    case "exitedReviewMode":
      return undefined;
    default:
      throw new Error(`Unsupported Codex App Server item type: ${header.type}`);
  }
}

export function normalizeItemEvent(
  method: "item/started" | "item/completed",
  value: unknown,
): ThreadEvent | undefined {
  const item = normalizedItem(value);
  if (item === undefined) return undefined;
  return {
    type: method === "item/started" ? "item.started" : "item.completed",
    item,
  };
}
