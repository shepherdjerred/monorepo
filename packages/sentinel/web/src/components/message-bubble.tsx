import { useState } from "react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight } from "lucide-react";

type ConversationEntry = {
  timestamp: string;
  role: string;
  content: string;
  toolName?: string | undefined;
  toolInput?: string | undefined;
  toolUseId?: string | undefined;
  permissionDecision?: string | undefined;
  turnNumber: number;
  model?: string | undefined;
  tokenUsage?: { input: number; output: number } | undefined;
  durationMs?: number | undefined;
  metadata?: Record<string, unknown> | undefined;
};

type MessageBubbleProps = {
  entry: ConversationEntry;
};

function roleStyle(role: string): string {
  switch (role) {
    case "user":
      return "bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800";
    case "assistant":
      return "bg-zinc-50 border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700";
    case "tool_use":
      return "bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800";
    case "tool_result":
      return "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800";
    case "system":
      return "bg-zinc-100 border-zinc-300 dark:bg-zinc-800 dark:border-zinc-600";
    default:
      return "bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-700";
  }
}

function roleLabel(role: string): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "tool_use":
      return "Tool Call";
    case "tool_result":
      return "Tool Result";
    case "system":
      return "System";
    default:
      return role;
  }
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString();
}

function CollapsibleCode({ content, defaultExpanded = false, maxLines = 20 }: {
  content: string;
  defaultExpanded?: boolean;
  maxLines?: number;
}) {
  const lines = content.split("\n");
  const isLong = lines.length > maxLines;
  const [expanded, setExpanded] = useState(defaultExpanded || !isLong);

  return (
    <div>
      <pre className="max-h-80 overflow-auto rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
        <code>{expanded ? content : lines.slice(0, maxLines).join("\n") + "\n..."}</code>
      </pre>
      {isLong && (
        <button
          onClick={() => { setExpanded(!expanded); }}
          className="mt-1 flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {expanded ? "Collapse" : `Show all ${String(lines.length)} lines`}
        </button>
      )}
    </div>
  );
}

function PermissionBadge({ decision }: { decision: string | undefined }) {
  if (decision == null) return null;
  const variant = decision === "allow" ? "success" : "error";
  const label = decision === "allow" ? "auto-allowed" : "denied";
  return (
    <span className={cn(
      "rounded px-1.5 py-0.5 text-xs",
      variant === "success"
        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
        : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    )}>
      {label}
    </span>
  );
}

function AssistantContent({ content }: { content: string }) {
  // The content is now plain text (extracted from BetaMessage content blocks)
  // No longer raw JSON, so render directly
  if (content.length === 0) {
    return <span className="text-xs italic text-zinc-400">(no text content)</span>;
  }
  return <div className="whitespace-pre-wrap text-sm">{content}</div>;
}

function ToolUseContent({ entry }: { entry: ConversationEntry }) {
  const [showInput, setShowInput] = useState(false);
  const input = entry.toolInput ?? entry.content;

  let formattedInput = input;
  try {
    formattedInput = JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    // Use as-is
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-yellow-200 px-2 py-0.5 text-xs font-semibold dark:bg-yellow-800">
          {entry.toolName ?? "unknown"}
        </span>
        <PermissionBadge decision={entry.permissionDecision} />
      </div>
      {formattedInput.length > 0 && (
        <div>
          <button
            onClick={() => { setShowInput(!showInput); }}
            className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            {showInput ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Input ({formattedInput.length} chars)
          </button>
          {showInput && (
            <pre className="mt-1 max-h-60 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800">
              <code>{formattedInput}</code>
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ToolResultContent({ entry }: { entry: ConversationEntry }) {
  const content = entry.content;

  // Try to detect if it's an error result
  let isError = false;
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed != null && typeof parsed === "object") {
      isError = ("is_error" in parsed && parsed.is_error === true)
        || ("type" in parsed && parsed.type === "error");
    }
  } catch {
    // Not JSON
  }

  return (
    <div>
      {entry.toolName != null && (
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-green-200 px-2 py-0.5 text-xs font-semibold dark:bg-green-800">
            {entry.toolName}
          </span>
          {isError && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900 dark:text-red-300">
              error
            </span>
          )}
        </div>
      )}
      <CollapsibleCode content={content} />
    </div>
  );
}

const McpServerSchema = z.object({
  name: z.string(),
});

const InitContentSchema = z.object({
  model: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
  mcpServers: z.array(McpServerSchema).optional(),
});

function SystemContent({ entry }: { entry: ConversationEntry }) {
  const metadataType = entry.metadata?.type;

  if (metadataType === "init") {
    try {
      const parsed: unknown = JSON.parse(entry.content);
      const result = InitContentSchema.safeParse(parsed);
      if (result.success) {
        const { model, tools, mcpServers } = result.data;
        return (
          <div className="space-y-2 text-xs">
            {model != null && (
              <div><span className="font-medium">Model:</span> {model}</div>
            )}
            {tools != null && (
              <div>
                <span className="font-medium">Tools:</span>{" "}
                <span className="text-zinc-500">{String(tools.length)} available</span>
              </div>
            )}
            {mcpServers != null && mcpServers.length > 0 && (
              <div>
                <span className="font-medium">MCP Servers:</span>{" "}
                {mcpServers.map((s) => s.name).join(", ")}
              </div>
            )}
          </div>
        );
      }
    } catch {
      // Fall through to default
    }
  }

  return <CollapsibleCode content={entry.content} maxLines={5} />;
}

export function MessageBubble({ entry }: MessageBubbleProps) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        roleStyle(entry.role),
        entry.role === "system" && "italic",
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-semibold">{roleLabel(entry.role)}</span>
        {entry.model != null && (
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono text-xs dark:bg-zinc-700">
            {entry.model}
          </span>
        )}
        {entry.toolName != null && entry.role !== "tool_use" && entry.role !== "tool_result" && (
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 font-mono dark:bg-zinc-700">
            {entry.toolName}
          </span>
        )}
        <span>{formatTimestamp(entry.timestamp)}</span>
        <span>Turn #{entry.turnNumber}</span>
        {entry.tokenUsage != null && (
          <span className="font-mono text-zinc-400">
            {entry.tokenUsage.input.toLocaleString()} in / {entry.tokenUsage.output.toLocaleString()} out
          </span>
        )}
      </div>

      {entry.role === "assistant" && <AssistantContent content={entry.content} />}
      {entry.role === "tool_use" && <ToolUseContent entry={entry} />}
      {entry.role === "tool_result" && <ToolResultContent entry={entry} />}
      {entry.role === "system" && <SystemContent entry={entry} />}
      {entry.role === "user" && (
        <div className="whitespace-pre-wrap text-sm">{entry.content}</div>
      )}
    </div>
  );
}
