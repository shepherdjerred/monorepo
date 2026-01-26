import { spawn } from "child_process";
import { loggers } from "../utils/index.js";
import type { EditResult, FileChange } from "./types.js";

const logger = loggers.editor.child("claude-client");

/**
 * Options for executing an edit with Claude Code
 */
export type ExecuteEditOptions = {
  prompt: string;
  workingDirectory: string;
  resumeSessionId?: string;
  allowedPaths?: string[];
}

/**
 * Message types from Claude Code output
 */
type ClaudeMessage = {
  type: string;
  subtype?: string;
  session_id?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    old_string?: string;
    new_string?: string;
    content?: string;
  };
  content?: string;
  result?: {
    text?: string;
  };
}

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
    hasResume: !!resumeSessionId,
  });

  return new Promise((resolve, reject) => {
    const args = [
      "--print", // Non-interactive mode
      "--output-format", "stream-json", // Structured output
      "--permission-mode", "acceptEdits", // Auto-accept file edits
      "--allowedTools", "Read,Write,Edit,Glob,Grep", // No Bash for security
    ];

    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
    }

    // Add the prompt
    args.push(prompt);

    const proc = spawn("claude", args, {
      cwd: workingDirectory,
      env: { ...process.env },
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
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as ClaudeMessage;
          processMessage(msg, {
            setSessionId: (id) => {
              sdkSessionId = id;
            },
            addChange: (change) => {
              // Deduplicate by file path
              const existing = changes.findIndex(
                (c) => c.filePath === change.filePath,
              );
              if (existing >= 0) {
                changes[existing] = change;
              } else {
                changes.push(change);
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
        reject(new Error(`Claude process exited with code ${String(code)}: ${stderr}`));
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
}

function processMessage(msg: ClaudeMessage, handlers: MessageHandlers): void {
  // Capture session ID from init message
  if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
    handlers.setSessionId(msg.session_id);
  }

  // Capture file reads for tracking original content
  if (
    msg.type === "tool_result" &&
    msg.tool_name === "Read" &&
    msg.result?.text
  ) {
    // The tool input should have the file path - this is a simplified version
    // In practice, we'd need to correlate with the tool_use message
  }

  // Capture file writes/edits
  if (msg.type === "tool_use") {
    const input = msg.tool_input;
    if (!input?.file_path) return;

    if (msg.tool_name === "Write" && input.content !== undefined) {
      handlers.addChange({
        filePath: input.file_path,
        oldContent: null,
        newContent: input.content,
        changeType: "create",
      });
    }

    if (msg.tool_name === "Edit" && input.old_string && input.new_string) {
      // For edits, we track partial changes
      // In a full implementation, we'd need to reconstruct the full file
      handlers.addChange({
        filePath: input.file_path,
        oldContent: input.old_string,
        newContent: input.new_string,
        changeType: "modify",
      });
    }
  }

  // Capture assistant summary
  if (msg.type === "assistant" && msg.content) {
    handlers.setSummary(msg.content);
  }
}

function extractFinalSummary(output: string): string {
  // Try to extract the last assistant message as summary
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.trim()) continue;
    try {
      const msg = JSON.parse(line) as ClaudeMessage;
      if (msg.type === "assistant" && msg.content) {
        return msg.content;
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
  const hasApiKey = !!process.env["ANTHROPIC_API_KEY"];

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
 * Check if gh CLI is available and authenticated
 */
export async function checkGhPrerequisites(): Promise<{
  installed: boolean;
  authenticated: boolean;
}> {
  return new Promise((resolve) => {
    const proc = spawn("gh", ["auth", "status"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.on("close", (code) => {
      resolve({
        installed: true,
        authenticated: code === 0,
      });
    });

    proc.on("error", () => {
      resolve({
        installed: false,
        authenticated: false,
      });
    });
  });
}
