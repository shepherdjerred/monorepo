import { z } from "zod/v4";
import {
  ImessageActionSchema,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";

export const BlueBubblesMessageSchema = z.object({
  originalROWID: z.number().int().positive(),
  guid: z.string().min(1).max(200),
  dateCreated: z.number().int().nonnegative(),
  isFromMe: z.boolean(),
  text: z.string().nullable(),
  handle: z.object({ address: z.string() }).nullable(),
  itemType: z.number().int(),
  associatedMessageType: z.number().int().nullable(),
  chats: z.array(
    z.object({ guid: z.string().min(1).max(200), style: z.number().int() }),
  ),
});
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
export function blueBubblesCommand(
  message: z.infer<typeof BlueBubblesMessageSchema>,
  owners: readonly string[],
): ImessageCommand | undefined {
  if (
    message.isFromMe ||
    message.itemType !== 0 ||
    (message.associatedMessageType !== null &&
      message.associatedMessageType !== 0) ||
    message.text === null ||
    message.text.trim() === "" ||
    message.handle === null ||
    !owners.includes(message.handle.address)
  )
    return;
  const chat = message.chats.length === 1 ? message.chats[0] : undefined;
  // A group can expose agent output to non-owners; only the owner's direct conversations are accepted.
  if (chat?.style !== 45) return;
  return {
    messageId: message.guid,
    conversationId: chat.guid,
    submittedAt: new Date(message.dateCreated).toISOString(),
    sourceSequence: message.originalROWID,
    action: parseImessageAction(message.text),
  };
}
