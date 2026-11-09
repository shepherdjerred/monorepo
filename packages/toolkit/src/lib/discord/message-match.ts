import type { IpcMessage } from "#lib/discord/ipc.ts";

export function messageMatches(
  message: IpcMessage,
  request: {
    channelId: string;
    fromUserId?: string | undefined;
    contains?: string | undefined;
  },
): boolean {
  if (message.channelId !== request.channelId) return false;
  if (request.fromUserId != null && message.authorId !== request.fromUserId)
    return false;
  if (request.contains == null) return true;
  const haystack = [
    message.content,
    ...message.embeds.flatMap((embed) => [
      embed.title ?? "",
      embed.description ?? "",
    ]),
  ]
    .join("\n")
    .toLowerCase();
  return haystack.includes(request.contains.toLowerCase());
}
