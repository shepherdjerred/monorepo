import { z } from "zod";

const AssistantSchema = z.object({
  type: z.literal("assistant"),
  sessionId: z.string(),
  message: z.object({ model: z.string().min(1).max(200) }),
});

/** Read only the transcript explicitly supplied by this session's native hook. */
export async function claudeModel(
  env: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
  const file = env["CLAUDE_TRANSCRIPT_PATH"];
  const sessionId = env["CLAUDE_CODE_SESSION_ID"];
  if (file === undefined || sessionId === undefined) return undefined;
  try {
    const text = await Bun.file(file).text();
    const lines = text.trim().split("\n").reverse();
    for (const line of lines) {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        continue;
      }
      const result = AssistantSchema.safeParse(value);
      if (result.success && result.data.sessionId === sessionId)
        return result.data.message.model;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
