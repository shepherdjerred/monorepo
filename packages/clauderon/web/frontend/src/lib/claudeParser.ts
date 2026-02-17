/**
 * Parser for Claude Code PTY output to extract chat-like messages.
 * This is a best-effort heuristic parser since PTY output isn't structured.
 */

export type MessageRole = "user" | "assistant" | "system";

export type ToolUse = {
  name: string;
  description: string | undefined;
  input: Record<string, unknown> | undefined;
  result: string | undefined;
};

export type CodeBlock = {
  language: string;
  code: string;
  filePath?: string;
};

export type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  toolUses: ToolUse[] | undefined;
  codeBlocks: CodeBlock[] | undefined;
};

/**
 * Strip ANSI escape codes from terminal output
 */
export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*[a-z]/gi, "");
}

/**
 * Extract code blocks from text (markdown-style)
 */
export function extractCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      language: match[1] ?? "text",
      code: match[2]?.trim() ?? "",
    });
  }

  return blocks;
}

/**
 * Extract file paths from tool use patterns
 */
export function extractFilePath(text: string): string | undefined {
  // Match patterns like: file_path: "/path/to/file"
  const filePathMatch = /file_path:\s*["']([^"']+)["']/.exec(text);
  if (filePathMatch != null) {
    return filePathMatch[1];
  }

  // Match patterns like: Reading /path/to/file
  const readingMatch = /Reading\s+(\S+)/i.exec(text);
  if (readingMatch != null) {
    return readingMatch[1];
  }

  // Match patterns like: Writing to /path/to/file
  const writingMatch = /Writing\s+(?:to\s+)?(\S+)/i.exec(text);
  if (writingMatch != null) {
    return writingMatch[1];
  }

  return undefined;
}

/**
 * Parse tool uses from text
 */
export function parseToolUses(text: string): ToolUse[] {
  const tools: ToolUse[] = [];

  // Common Claude Code tool patterns
  const toolPatterns = [
    { name: "Read", pattern: /Reading\s+(.+)/gi },
    { name: "Write", pattern: /Writing\s+(?:to\s+)?(.+)/gi },
    { name: "Edit", pattern: /Editing\s+(.+)/gi },
    { name: "Bash", pattern: /Running:\s*(.+)/gi },
    { name: "Grep", pattern: /Searching\s+(?:for\s+)?(.+)/gi },
    { name: "Glob", pattern: /Finding\s+files:\s*(.+)/gi },
  ];

  for (const { name, pattern } of toolPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      tools.push({
        name,
        description: match[1]?.trim(),
        input: undefined,
        result: undefined,
      });
    }
  }

  return tools;
}

/**
 * Split terminal output into message-like chunks
 */
export function parseMessages(terminalOutput: string): Message[] {
  const messages: Message[] = [];
  const cleanOutput = stripAnsi(terminalOutput);

  // Split on common delimiters (user prompts, assistant responses)
  const lines = cleanOutput.split("\n");
  let currentMessage: {
    role: MessageRole;
    content: string[];
    toolUses: ToolUse[];
  } | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect user input (usually starts with > or $ or specific prompts)
    if (trimmed.startsWith(">") || trimmed.startsWith("User:")) {
      if (currentMessage != null) {
        messages.push(buildMessage(currentMessage));
      }
      currentMessage = {
        role: "user",
        content: [trimmed.replace(/^(?:>|User:)\s*/, "")],
        toolUses: [],
      };
      continue;
    }

    // Detect assistant responses
    if (
      trimmed.startsWith("Assistant:") ||
      trimmed.includes("I'll") ||
      trimmed.includes("Let me")
    ) {
      if (currentMessage != null) {
        messages.push(buildMessage(currentMessage));
      }
      currentMessage = {
        role: "assistant",
        content: [trimmed.replace(/^Assistant:\s*/, "")],
        toolUses: [],
      };
      continue;
    }

    // Detect tool uses
    const tools = parseToolUses(line);
    if (tools.length > 0) {
      currentMessage ??= {
        role: "assistant",
        content: [],
        toolUses: [],
      };
      currentMessage.toolUses.push(...tools);
    }

    // Add line to current message
    if (currentMessage != null && trimmed) {
      currentMessage.content.push(trimmed);
    }
  }

  // Add final message
  if (currentMessage != null) {
    messages.push(buildMessage(currentMessage));
  }

  return messages;
}

function buildMessage(data: {
  role: MessageRole;
  content: string[];
  toolUses: ToolUse[];
}): Message {
  const content = data.content.join("\n");
  const codeBlocks = extractCodeBlocks(content);

  return {
    id: crypto.randomUUID(),
    role: data.role,
    content,
    timestamp: new Date(),
    toolUses: data.toolUses.length > 0 ? data.toolUses : undefined,
    codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
  };
}

/**
 * Incrementally parse new terminal output and update message history
 */
export class MessageParser {
  private buffer = "";
  private messages: Message[] = [];

  addOutput(output: string): void {
    this.buffer += output;
    this.messages = parseMessages(this.buffer);
  }

  getMessages(): Message[] {
    return this.messages;
  }

  clear(): void {
    this.buffer = "";
    this.messages = [];
  }
}
