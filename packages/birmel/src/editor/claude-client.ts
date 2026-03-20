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

const ClaudeMessageSchema = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    tool_name: z.string().optional(),
    tool_input: z
      .object({
        file_path: z.string().optional(),
        old_string: z.string().optional(),
        new_string: z.string().optional(),
        content: z.string().optional(),
      })
      .optional(),
    content: z.string().optional(),
    result: z
      .object({
        text: z.string().optional(),
      })
      .optional(),
  })
  .loose();

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

  const proc = Bun.spawn(["claude", ...args], {
    cwd: workingDirectory,
    env: { ...Bun.env },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    logger.error("Claude process exited with error", undefined, {
      code: exitCode,
      stderr,
    });
    throw new Error(
      `Claude process exited with code ${String(exitCode)}: ${stderr}`,
    );
  }

  let sdkSessionId: string | null = null;
  const changes: FileChange[] = [];
  let summary = "";

  const handlers: MessageHandlers = {
    setSessionId: (id) => {
      sdkSessionId = id;
    },
    addChange: (change) => {
      const existing = changes.findIndex((c) => c.filePath === change.filePath);
      if (existing === -1) {
        changes.push(change);
      } else {
        changes[existing] = change;
      }
    },
    setSummary: (s) => {
      summary = s;
    },
    trackOriginal: () => {
      // No-op: originals only needed during streaming
    },
  };

  for (const line of stdout.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      const parseResult = ClaudeMessageSchema.safeParse(parsed);
      if (!parseResult.success) {
        continue;
      }
      processMessage(parseResult.data, handlers);
    } catch {
      // Not JSON, ignore
    }
  }

  if (!summary) {
    summary = extractFinalSummary(stdout);
  }

  logger.info("Edit complete", {
    sessionId: sdkSessionId,
    changeCount: changes.length,
  });

  return {
    sdkSessionId,
    changes,
    summary: summary || "Changes applied successfully.",
  };
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
  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
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

  try {
    const proc = Bun.spawn(["claude", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ]);
    if (exitCode === 0) {
      return { installed: true, version: stdout.trim(), hasApiKey };
    }
    return { installed: false, hasApiKey };
  } catch {
    return { installed: false, hasApiKey };
  }
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
