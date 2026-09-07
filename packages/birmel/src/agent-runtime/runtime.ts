import {
  TaskPacketSchema,
  type ContextBundle,
  type TaskPacket,
  type TurnInput,
} from "@shepherdjerred/birmel/agent-runtime/contracts.ts";

function relevantContext(bundle: ContextBundle): string {
  return bundle.sources
    .filter(({ kind }) => kind !== "system-policy" && kind !== "persona")
    .map(({ content }) => content)
    .join("\n");
}

export function createTaskPacket(options: {
  turn: TurnInput;
  context: ContextBundle;
  personaId: string;
  persona: string;
}): TaskPacket {
  return TaskPacketSchema.parse({
    request: options.turn.content,
    guildId: options.turn.guildId,
    channelId: options.turn.channelId,
    ...(options.turn.threadId == null
      ? {}
      : { threadId: options.turn.threadId }),
    userId: options.turn.userId,
    username: options.turn.username,
    personaId: options.personaId,
    persona: options.persona,
    context: relevantContext(options.context),
    attachments: options.turn.attachments,
    ...(options.turn.referenceResolutionError == null
      ? {}
      : { referenceResolutionError: options.turn.referenceResolutionError }),
  });
}
