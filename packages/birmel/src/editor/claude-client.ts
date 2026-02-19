import { spawn } from "node:child_process";
import { z } from "zod";
import { loggers } from "@shepherdjerred/birmel/utils/logger.ts";
import type { EditResult, FileChange } from "./types.ts";

const logger = loggers.editor.child("claude-client");

/**
 * Options for executing an edit with Claude Code
 */
export type ExecuteEditOptions = {
  prompt: string;
  workingDirectory: string;
  resumeSessionId?: string | undefined;
  allowedPaths?: string[] | undefined;
};

const ClaudeMessageSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  session_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.object({
    file_path: z.string().optional(),
    old_string: z.string().optional(),
    new_string: z.string().optional(),
    content: z.string().optional(),
  }).optional(),
  content: z.string().optional(),
  result: z.object({
    text: z.string().optional(),
  }).optional(),
}).loose();

type ClaudeMessage = z.infer<typeof ClaudeMessageSchema>;

/**
 * Execute an edit using Claude Code CLI
 * Runs Claude in non-interactive mode with restricted tools
 *
 * Prerequisites:
 * - Claude Code CLI installed (`claude` command available)
 * - Authenticated via ANTHROPIC_API_KEY env var or `claude login`
 */
export async function executeEdit(
  opts: ExecuteEditOptions,
): Promise<EditResult> {
  const { prompt, workingDirectory, resumeSessionId } = opts;

  logger.info("Executing edit", {
    workingDirectory,
    hasResume: !(resumeSessionId == null || resumeSessionId.length === 0),
  });

  return new Promise((resolve, reject) => {
    const args = [
      "--print", // Non-interactive mode
      "--output-format",
      "stream-json", // Structured output
      "--permission-mode",
      "acceptEdits", // Auto-accept file edits
      "--allowedTools",
      "Read,Write,Edit,Glob,Grep", // No Bash for security
    ];

    if (resumeSessionId != null && resumeSessionId.length > 0) {
      args.push("--resume", resumeSessionId);
    }

    // Add the prompt
    args.push(prompt);

    const proc = spawn("claude", args, {
      cwd: workingDirectory,
      env: { ...Bun.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let sdkSessionId: string | null = null;
    const changes: FileChange[] = [];
    const fileContents = new Map<string, string>(); // Track original contents
    let summary = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
      // Parse streaming JSON output
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? ""; // Keep incomplete line

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(line);
          const parseResult = ClaudeMessageSchema.safeParse(parsed);
          if (!parseResult.success) {
            continue;
          }
          const msg = parseResult.data;
          processMessage(msg, {
            setSessionId: (id) => {
              sdkSessionId = id;
            },
            addChange: (change) => {
              // Deduplicate by file path
              const existing = changes.findIndex(
                (c) => c.filePath === change.filePath,
              );
              if (existing === -1) {
                changes.push(change);
              } else {
                changes[existing] = change;
              }
            },
            setSummary: (s) => {
              summary = s;
            },
            trackOriginal: (path, content) => {
              if (!fileContents.has(path)) {
                fileContents.set(path, content);
              }
            },
          });
        } catch {
          // Not JSON, ignore
        }
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        logger.error("Claude process exited with error", undefined, {
          code,
          stderr,
        });
        reject(
          new Error(
            `Claude process exited with code ${String(code)}: ${stderr}`,
          ),
        );
        return;
      }

      // Extract summary from final assistant message if not already set
      if (!summary) {
        summary = extractFinalSummary(stdout);
      }

      logger.info("Edit complete", {
        sessionId: sdkSessionId,
        changeCount: changes.length,
      });

      resolve({
        sdkSessionId,
        changes,
        summary: summary || "Changes applied successfully.",
      });
    });

    proc.on("error", (err) => {
      logger.error("Failed to spawn Claude process", err);
      reject(err);
    });
  });
}

type MessageHandlers = {
  setSessionId: (id: string) => void;
  addChange: (change: FileChange) => void;
  setSummary: (summary: string) => void;
  trackOriginal: (path: string, content: string) => void;
};

function processToolUse(msg: ClaudeMessage, handlers: MessageHandlers): void {
  const input = msg.tool_input;
  if (input?.file_path == null || input.file_path.length === 0) {
    return;
  }

  if (msg.tool_name === "Write" && input.content !== undefined) {
    handlers.addChange({
      filePath: input.file_path,
      oldContent: null,
      newContent: input.content,
      changeType: "create",
    });
  }

  if (
    msg.tool_name === "Edit" &&
    input.old_string != null &&
    input.old_string.length > 0 &&
    input.new_string != null &&
    input.new_string.length > 0
  ) {
    handlers.addChange({
      filePath: input.file_path,
      oldContent: input.old_string,
      newContent: input.new_string,
      changeType: "modify",
    });
  }
}

function processMessage(msg: ClaudeMessage, handlers: MessageHandlers): void {
  // Capture session ID from init message
  if (
    msg.type === "system" &&
    msg.subtype === "init" &&
    msg.session_id != null &&
    msg.session_id.length > 0
  ) {
    handlers.setSessionId(msg.session_id);
  }

  // Capture file writes/edits
  if (msg.type === "tool_use") {
    processToolUse(msg, handlers);
  }

  // Capture assistant summary
  if (
    msg.type === "assistant" &&
    msg.content != null &&
    msg.content.length > 0
  ) {
    handlers.setSummary(msg.content);
  }
}

function extractFinalSummary(output: string): string {
  // Try to extract the last assistant message as summary
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line?.trim() == null || line.trim().length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      const result = ClaudeMessageSchema.safeParse(parsed);
      if (!result.success) {
        continue;
      }
      if (
        result.data.type === "assistant" &&
        result.data.content != null &&
        result.data.content.length > 0
      ) {
        return result.data.content;
      }
    } catch {
      // Not JSON
    }
  }
  return "";
}

/**
 * Check if Claude Code CLI is available
 */
export async function isClaudeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Check Claude CLI prerequisites and return diagnostic info
 */
export async function checkClaudePrerequisites(): Promise<{
  installed: boolean;
  version?: string;
  hasApiKey: boolean;
}> {
  const hasApiKey =
    Bun.env["ANTHROPIC_API_KEY"] != null &&
    Bun.env["ANTHROPIC_API_KEY"].length > 0;

  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({
          installed: true,
          version: stdout.trim(),
          hasApiKey,
        });
      } else {
        resolve({
          installed: false,
          hasApiKey,
        });
      }
    });

    proc.on("error", () => {
      resolve({
        installed: false,
        hasApiKey,
      });
    });
  });
}

/**
 * Check if gh CLI is installed (per-user OAuth tokens are used for auth)
 */
export async function checkGhPrerequisites(): Promise<{
  installed: boolean;
}> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.on("close", (code) => {
      resolve({ installed: code === 0 });
    });

    proc.on("error", () => {
      resolve({ installed: false });
    });
  });
}
