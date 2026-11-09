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
