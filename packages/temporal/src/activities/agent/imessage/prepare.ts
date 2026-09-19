import { createTemporalClient } from "#client";
import { imessageIngressConfig } from "#config/imessage.ts";
import {
  bindAgentChat,
  getAgentChat,
  listAgentChats,
  resolveAgentChatBinding,
} from "#lib/agent-chat-client.ts";
import {
  ImessageCommandSchema,
  PreparedImessageCommandSchema,
  type ImessageCommand,
} from "#shared/agent/agent-chat-imessage.ts";

export const IMESSAGE_HELP =
  "Use /new claude <prompt> or /new codex <prompt>; /chats lists recent chats; /use <chat-id> selects any previous chat; /continue <chat-id> <prompt> continues it directly. Ordinary text continues the selected chat. Text prompts must be 1–4000 characters.";

export async function prepareImessageCommand(rawCommand: ImessageCommand) {
  const input = ImessageCommandSchema.parse(rawCommand);
  const action = input.action;
  const message = (content: string) =>
    PreparedImessageCommandSchema.parse({ kind: "message", content });
  if (action.kind === "help") return message(IMESSAGE_HELP);
  const temporal = await createTemporalClient();
  const client = temporal.workflow;
  const source = {
    kind: "imessage" as const,
    conversationId: input.conversationId,
  };
  if (action.kind === "list") {
    const chats = await listAgentChats(client);
    const recent = chats
      .toSorted(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )
      .slice(0, 20);
    return message(
      recent.length === 0
        ? "No recent durable chats. Use /new claude <prompt> or /new codex <prompt>."
        : recent
            .map(
              (chat) =>
                `${chat.config.chatId} — ${chat.config.provider}: ${chat.config.title}`,
            )
            .join("\n"),
    );
  }
  if (action.kind === "use") {
    const chat = await getAgentChat(client, action.chatId);
    if (chat === undefined)
      return message(
        `Unknown chat: ${action.chatId}. Use /chats to list recent chats.`,
      );
    await bindAgentChat(client, source, action.chatId, {
      updatedAt: input.submittedAt,
      sourceSequence: input.sourceSequence,
    });
    return message(
      `Selected ${action.chatId}. Send ordinary text to continue.`,
    );
  }
  const digest = new Bun.CryptoHasher("sha256")
    .update(input.messageId)
    .digest("hex");
  const request = {
    turnId: `imessage-${digest}`,
    prompt: action.prompt,
    submittedAt: input.submittedAt,
    source,
    sourceSequence: input.sourceSequence,
  };
  if (action.kind === "new") {
    const config = await imessageIngressConfig();
    return PreparedImessageCommandSchema.parse({
      kind: "turn",
      command: {
        kind: "new",
        request,
        config: {
          chatId: `chat-imessage-${digest}`,
          title: action.prompt.slice(0, 80),
          provider: action.provider,
          model:
            action.provider === "claude"
              ? config.claudeModel
              : config.codexModel,
          origin: source,
          createdAt: input.submittedAt,
          maxTurnsPerMessage: 24,
        },
      },
    });
  }
  const chat =
    action.chatId === undefined
      ? await resolveAgentChatBinding(client, source)
      : await getAgentChat(client, action.chatId);
  if (chat === undefined)
    return message(
      action.chatId === undefined
        ? `No selected chat. ${IMESSAGE_HELP}`
        : `Unknown chat: ${action.chatId}. Use /chats to list recent chats.`,
    );
  return PreparedImessageCommandSchema.parse({
    kind: "turn",
    command: { kind: "continue", chatId: chat.config.chatId, request },
  });
}
