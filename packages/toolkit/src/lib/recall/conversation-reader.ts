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
      const obj = JSON.parse(line) as {
        type?: string;
        message?: {
          role?: string;
          content?: string | { type?: string; text?: string }[];
        };
        timestamp?: string;
      };

      if (obj.type !== "user" && obj.type !== "assistant") continue;

      const msg = obj.message;
      if (msg == null) continue;

      const role = msg.role as "user" | "assistant" | undefined;
      if (role !== "user" && role !== "assistant") continue;

      let text = "";
      if (typeof msg.content === "string") {
        text = msg.content;
      } else if (Array.isArray(msg.content)) {
        text = msg.content
          .filter(
            (c): c is { type: string; text: string } =>
              typeof c === "object" &&
              c?.type === "text" &&
              typeof c.text === "string",
          )
          .map((c) => c.text)
          .join("\n");
      }

      if (text.trim().length === 0) continue;

      // Skip very short messages (likely just acknowledgments)
      if (text.trim().length < 10) continue;

      // Skip tool use results and system messages
      if (text.startsWith("<tool_use>") || text.startsWith("<system")) continue;

      messages.push({
        role,
        text: text.trim(),
        ...(obj.timestamp == null ? {} : { timestamp: obj.timestamp }),
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
