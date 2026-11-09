import { z } from "zod/v4";
export const Messages = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      channelId: z.string(),
      authorId: z.string(),
      authorTag: z.string(),
      content: z.string(),
      createdAt: z.string(),
      embeds: z.array(
        z.object({
          title: z.string().nullable(),
          description: z.string().nullable(),
          fields: z.array(z.object({ name: z.string(), value: z.string() })),
        }),
      ),
    }),
  ),
});

/** Preserve the message and embed text in both publication and reconciliation receipts. */
export function discordMessageText(
  message: z.infer<typeof Messages>["messages"][number],
): string {
  return [
    message.content,
    ...message.embeds.map((embed) =>
      [
        embed.title,
        embed.description,
        ...embed.fields.map((field) => `${field.name}: ${field.value}`),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n");
}
