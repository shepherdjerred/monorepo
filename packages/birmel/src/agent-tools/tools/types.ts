import { z } from "zod";

export const ToolResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.unknown().optional(),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

export type ToolContext = {
  guildId: string;
  channelId: string;
  userId: string;
};
