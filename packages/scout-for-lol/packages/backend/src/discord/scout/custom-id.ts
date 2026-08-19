import { z } from "zod";
import { ExploreConversationIdSchema } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

export const SCOUT_COMPONENT_NAMESPACE = "scout";
export const SCOUT_COMPONENT_VERSION = "1";

const ScoutPublishCustomIdSchema = z.strictObject({
  conversationId: ExploreConversationIdSchema,
  assistantMessageId: z.uuid(),
});

export type ScoutPublishCustomId = z.infer<typeof ScoutPublishCustomIdSchema>;

/** `scout:1:publish:<conversationId>:<assistantMessageId>` */
export function formatScoutPublishCustomId(
  input: ScoutPublishCustomId,
): string {
  const parsed = ScoutPublishCustomIdSchema.parse(input);
  const id = [
    SCOUT_COMPONENT_NAMESPACE,
    SCOUT_COMPONENT_VERSION,
    "publish",
    parsed.conversationId,
    parsed.assistantMessageId,
  ].join(":");
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Scout custom ID is ${id.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit.`,
    );
  }
  return id;
}

export function parseScoutPublishCustomId(
  raw: string,
): ScoutPublishCustomId | undefined {
  const segments = raw.split(":");
  if (segments.length !== 5) {
    return undefined;
  }
  const [namespace, version, action, conversationId, assistantMessageId] =
    segments;
  if (
    namespace !== SCOUT_COMPONENT_NAMESPACE ||
    version !== SCOUT_COMPONENT_VERSION ||
    action !== "publish"
  ) {
    return undefined;
  }
  const parsed = ScoutPublishCustomIdSchema.safeParse({
    conversationId,
    assistantMessageId,
  });
  return parsed.success ? parsed.data : undefined;
}

export function isScoutCustomId(raw: string): boolean {
  return raw.startsWith(`${SCOUT_COMPONENT_NAMESPACE}:`);
}
