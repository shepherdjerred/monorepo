import { z } from "zod/v4";
import { blueBubblesRequest } from "#lib/bluebubbles/client.ts";

const InputSchema = z.strictObject({
  conversationId: z.string().min(1).max(200),
  messageId: z.string().min(1).max(200),
  content: z.string().max(500_000),
});
export async function deliverImessageResponse(
  rawInput: z.infer<typeof InputSchema>,
): Promise<void> {
  const input = InputSchema.parse(rawInput);
  // tempGuid is only an in-flight cache in BlueBubbles, not a durable idempotency key.
  // The Workflow deliberately uses one delivery attempt after checkpointing the response.
  await blueBubblesRequest("/api/v1/message/text", {
    chatGuid: input.conversationId,
    tempGuid: `reply-${new Bun.CryptoHasher("sha256").update(input.messageId).digest("hex")}`,
    message: input.content === "" ? "(Agent returned no text.)" : input.content,
    method: "apple-script",
  });
}
