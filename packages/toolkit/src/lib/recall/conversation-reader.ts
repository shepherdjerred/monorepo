import { z } from "zod";

export type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
};

const ContentBlock = z.object({ type: z.string(), text: z.string() });

function getStringProp(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function extractText(msg: Record<string, unknown>): string {
  const content = msg["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c: unknown) => {
      const result = ContentBlock.safeParse(c);
      return result.success && result.data.type === "text";
    })
    .map((c: unknown) => ContentBlock.parse(c).text)
    .join("\n");
}

/**
 * Read a Claude Code conversation JSONL file and extract text content.
 * Uses streaming line reader to avoid loading entire file into memory.
 * Returns concatenated user + assistant messages as a single markdown string.
 */
export async function readConversation(filePath: string): Promise<string> {
  const messages: ConversationMessage[] = [];

  // Stream the file line by line instead of loading it all into memory
  const file = Bun.file(filePath);
  const stream = file.stream();
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      processLine(line, messages);
    }
  }
  // Process any remaining content
  if (buffer.trim().length > 0) {
    processLine(buffer, messages);
  }

  if (messages.length === 0) return "";

  // Build a markdown document from the conversation
  const parts: string[] = [];

  // Use first user message as a rough title
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser != null) {
    const titleText = firstUser.text.slice(0, 100).replaceAll("\n", " ");
    parts.push(`# ${titleText}`);
    parts.push("");
  }

  for (const msg of messages) {
    // Let the chunker handle splitting — don't truncate here
    parts.push(`**${msg.role}:** ${msg.text}`);
    parts.push("");
  }

  return parts.join("\n");
}

function processLine(line: string, messages: ConversationMessage[]): void {
  const trimmed = line.trim();
  if (trimmed.length === 0) return;

  try {
    const obj = z.record(z.string(), z.unknown()).parse(JSON.parse(trimmed));

    if (obj["type"] !== "user" && obj["type"] !== "assistant") return;

    const msg = obj["message"];
    if (msg == null || typeof msg !== "object") return;

    const msgRecord = z.record(z.string(), z.unknown()).parse(msg);
    const role = getStringProp(msgRecord, "role");
    if (role !== "user" && role !== "assistant") return;

    const text = extractText(msgRecord);

    if (text.trim().length < 5) return;

    // Skip tool use results and system messages
    if (text.startsWith("<tool_use>") || text.startsWith("<system")) return;

    const timestamp = getStringProp(obj, "timestamp");
    messages.push({
      role,
      text: text.trim(),
      ...(timestamp == null ? {} : { timestamp }),
    });
  } catch {
    // Skip malformed lines
  }
}
