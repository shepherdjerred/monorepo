import { query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { traceClaudeAgent } from "@shepherdjerred/llm-observability";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import type { EditResult, FileChange } from "./types.ts";

const TextBlockSchema = z
  .object({ type: z.literal("text"), text: z.string() })
  .loose();

const ToolUseBlockSchema = z
  .object({
    type: z.literal("tool_use"),
    name: z.string(),
    input: z.unknown(),
  })
  .loose();

const WriteToolInputSchema = z
  .object({ file_path: z.string().min(1), content: z.string() })
  .loose();

const EditToolInputSchema = z
  .object({
    file_path: z.string().min(1),
    old_string: z.string().min(1),
    new_string: z.string().min(1),
  })
  .loose();

type ToolUseBlock = z.infer<typeof ToolUseBlockSchema>;

const logger = loggers.editor.child("claude-client");

/**
 * Options for executing an edit with Claude Agent SDK
 */
export type ExecuteEditOptions = {
  prompt: string;
  workingDirectory: string;
  resumeSessionId?: string | undefined;
  allowedPaths?: string[] | undefined;
};

const ALLOWED_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

/**
 * Execute an edit using the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`).
 *
 * Runs Claude in non-interactive mode with restricted tools (Read, Write, Edit,
 * Glob, Grep — no Bash). Auto-accepts file edits via `permissionMode:
 * "acceptEdits"`. Supports session resumption.
 *
 * Migrated from `Bun.spawn(["claude", ...args])` in 2026-05 to avoid the
 * subprocess + stream-json parsing dance and to gain canonical `gen_ai.*`
 * spans via `traceClaudeAgent`. The SDK uses the same auth (`ANTHROPIC_API_KEY`
 * or `claude login`).
 */
export async function executeEdit(
  opts: ExecuteEditOptions,
): Promise<EditResult> {
  const { prompt, workingDirectory, resumeSessionId } = opts;

  logger.info("Executing edit", {
    workingDirectory,
    hasResume: !(resumeSessionId == null || resumeSessionId.length === 0),
  });

  const sdkOptions = {
    cwd: workingDirectory,
    permissionMode: "acceptEdits" as const,
    allowedTools: ALLOWED_TOOLS,
    ...(resumeSessionId != null && resumeSessionId.length > 0
      ? { resume: resumeSessionId }
      : {}),
  };

  let sdkSessionId: string | null = null;
  const changes: FileChange[] = [];
  let summary = "";
  let lastAssistantText = "";

  try {
    for await (const message of traceClaudeAgent(
      {
        service: "birmel",
        callSite: "editor-claude",
        request: {
          model: undefined,
          prompt,
          options: {
            workingDirectory,
            permissionMode: sdkOptions.permissionMode,
            allowedTools: ALLOWED_TOOLS,
            hasResume: resumeSessionId !== undefined && resumeSessionId !== "",
          },
        },
      },
      () => query({ prompt, options: sdkOptions }),
    )) {
      observeMessage(message, {
        setSessionId: (id) => {
          sdkSessionId = id;
        },
        addChange: (change) => {
          const existing = changes.findIndex(
            (c) => c.filePath === change.filePath,
          );
          if (existing === -1) {
            changes.push(change);
          } else {
            changes[existing] = change;
          }
        },
        setSummary: (text) => {
          lastAssistantText = text;
        },
      });
    }
  } catch (error) {
    logger.error("Claude Agent SDK call failed", undefined, {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (summary.length === 0) summary = lastAssistantText;

  logger.info("Edit complete", {
    sessionId: sdkSessionId,
    changeCount: changes.length,
  });

  return {
    sdkSessionId,
    changes,
    summary: summary.length > 0 ? summary : "Changes applied successfully.",
  };
}

type MessageHandlers = {
  setSessionId: (id: string) => void;
  addChange: (change: FileChange) => void;
  setSummary: (text: string) => void;
};

function observeMessage(message: SDKMessage, handlers: MessageHandlers): void {
  if (message.type === "system" && message.subtype === "init") {
    if (message.session_id !== "") handlers.setSessionId(message.session_id);
    return;
  }

  if (message.type === "assistant") {
    const content = message.message.content;
    if (!Array.isArray(content)) return;
    let assistantText = "";
    for (const block of content) {
      const textResult = TextBlockSchema.safeParse(block);
      if (textResult.success) {
        assistantText += textResult.data.text;
        continue;
      }
      const toolUseResult = ToolUseBlockSchema.safeParse(block);
      if (toolUseResult.success) {
        const change = extractChangeFromToolUse(toolUseResult.data);
        if (change !== undefined) handlers.addChange(change);
      }
    }
    if (assistantText.length > 0) handlers.setSummary(assistantText);
    return;
  }
}

function extractChangeFromToolUse(block: ToolUseBlock): FileChange | undefined {
  if (block.name === "Write") {
    const write = WriteToolInputSchema.safeParse(block.input);
    if (!write.success) return undefined;
    return {
      filePath: write.data.file_path,
      oldContent: null,
      newContent: write.data.content,
      changeType: "create",
    };
  }
  if (block.name === "Edit") {
    const edit = EditToolInputSchema.safeParse(block.input);
    if (!edit.success) return undefined;
    return {
      filePath: edit.data.file_path,
      oldContent: edit.data.old_string,
      newContent: edit.data.new_string,
      changeType: "modify",
    };
  }
  return undefined;
}

/**
 * Confirm the Claude Agent SDK is usable: ANTHROPIC_API_KEY (or `claude login`
 * credentials) must be present. Returns `false` when the env var is unset
 * — the SDK will still try the OAuth credential store, but for K8s deployments
 * we always inject the API key, so an unset var is the operational signal.
 */
export function isClaudeAvailable(): boolean {
  const apiKey = Bun.env["ANTHROPIC_API_KEY"];
  return apiKey !== undefined && apiKey.length > 0;
}

/**
 * Diagnostic info equivalent — kept for callers that still want a shape with
 * `installed` + `hasApiKey`. With the SDK there's no separate CLI binary to
 * check; "installed" maps to the SDK being importable, which is always true
 * once the dep is installed.
 */
export function checkClaudePrerequisites(): {
  installed: boolean;
  version: string | undefined;
  hasApiKey: boolean;
} {
  const hasApiKey =
    Bun.env["ANTHROPIC_API_KEY"] != null &&
    Bun.env["ANTHROPIC_API_KEY"].length > 0;
  return { installed: true, version: undefined, hasApiKey };
}

/**
 * Check if gh CLI is installed (per-user OAuth tokens are used for auth)
 */
export async function checkGhPrerequisites(): Promise<{
  installed: boolean;
}> {
  try {
    const proc = Bun.spawn(["gh", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return { installed: exitCode === 0 };
  } catch {
    return { installed: false };
  }
}
