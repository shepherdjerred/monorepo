import { readFile } from "node:fs/promises";

export type ConversationMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
};

export type Conversation = {
  messages: ConversationMessage[];
  projectDir: string;
};

function getStringProp(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}

function extractText(msg: Record<string, unknown>): string {
  const content = msg["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as unknown[])
    .filter(
      (c): c is Record<string, unknown> =>
        typeof c === "object" &&
        c != null &&
        (c as Record<string, unknown>)["type"] === "text" &&
        typeof (c as Record<string, unknown>)["text"] === "string",
    )
    .map((c) => c["text"] as string)
    .join("\n");
}

/**
 * Read a Claude Code conversation JSONL file and extract text content.
 * Returns concatenated user + assistant messages as a single markdown string.
 */
export async function readConversation(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  const lines = content.trim().split("\n");
  const messages: ConversationMessage[] = [];

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;

      if (obj["type"] !== "user" && obj["type"] !== "assistant") continue;

      const msg = obj["message"];
      if (msg == null || typeof msg !== "object") continue;

      const msgRecord = msg as Record<string, unknown>;
      const role = getStringProp(msgRecord, "role");
      if (role !== "user" && role !== "assistant") continue;

      const text = extractText(msgRecord);

      if (text.trim().length === 0) continue;

      // Skip very short messages (likely just acknowledgments)
      if (text.trim().length < 10) continue;

      // Skip tool use results and system messages
      if (text.startsWith("<tool_use>") || text.startsWith("<system")) continue;

      const timestamp = getStringProp(obj, "timestamp");
      messages.push({
        role,
        text: text.trim(),
        ...(timestamp == null ? {} : { timestamp }),
      });
    } catch {
      // Skip malformed lines
      continue;
    }
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
    // Only include substantive messages (skip very long tool outputs)
    const text = msg.text.length > 2000 ? msg.text.slice(0, 2000) + "..." : msg.text;
    parts.push(`**${msg.role}:** ${text}`);
    parts.push("");
  }

  return parts.join("\n");
}
