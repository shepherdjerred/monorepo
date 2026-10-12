import {
  ImessageActionSchema,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";

export function parseImessageAction(text: string): ImessageCommand["action"] {
  const trimmed = text.trim();
  let action: unknown;
  if (trimmed === "/chats") action = { kind: "list" };
  else if (trimmed === "/help") action = { kind: "help" };
  else if (trimmed.startsWith("/new ")) {
    const match = /^\/new (claude|codex) ([\s\S]+)$/.exec(trimmed);
    action = { kind: "new", provider: match?.[1], prompt: match?.[2] };
  } else if (trimmed.startsWith("/use "))
    action = { kind: "use", chatId: trimmed.slice(5).trim() };
  else if (trimmed.startsWith("/continue ")) {
    const match = /^\/continue (\S+) ([\s\S]+)$/.exec(trimmed);
    action = { kind: "continue", chatId: match?.[1], prompt: match?.[2] };
  } else
    action = trimmed.startsWith("/")
      ? { kind: "help" }
      : { kind: "continue", prompt: trimmed };
  const parsed = ImessageActionSchema.safeParse(action);
  return parsed.success ? parsed.data : { kind: "help" };
}
