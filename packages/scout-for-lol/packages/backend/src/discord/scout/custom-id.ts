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

const ScoutFollowUpCustomIdSchema = z.strictObject({
  conversationId: ExploreConversationIdSchema,
  assistantMessageId: z.uuid(),
  /** Position in the answer's saved `followUps`; the text is read back from it. */
  index: z.coerce.number().int().min(0).max(2),
});

export type ScoutFollowUpCustomId = z.infer<typeof ScoutFollowUpCustomIdSchema>;

/**
 * `scout:1:follow:<conversationId>:<assistantMessageId>:<index>`
 *
 * Carries an index rather than the follow-up's text: Discord caps a custom id
 * at 100 characters, and reading the text back from the saved answer means a
 * forged id can only ask a question Scout itself suggested.
 */
export function formatScoutFollowUpCustomId(
  input: ScoutFollowUpCustomId,
): string {
  const parsed = ScoutFollowUpCustomIdSchema.parse(input);
  const id = [
    SCOUT_COMPONENT_NAMESPACE,
    SCOUT_COMPONENT_VERSION,
    "follow",
    parsed.conversationId,
    parsed.assistantMessageId,
    parsed.index.toString(),
  ].join(":");
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Scout custom ID is ${id.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit.`,
    );
  }
  return id;
}

export function parseScoutFollowUpCustomId(
  raw: string,
): ScoutFollowUpCustomId | undefined {
  const segments = raw.split(":");
  if (segments.length !== 6) {
    return undefined;
  }
  const [
    namespace,
    version,
    action,
    conversationId,
    assistantMessageId,
    index,
  ] = segments;
  if (
    namespace !== SCOUT_COMPONENT_NAMESPACE ||
    version !== SCOUT_COMPONENT_VERSION ||
    action !== "follow"
  ) {
    return undefined;
  }
  const parsed = ScoutFollowUpCustomIdSchema.safeParse({
    conversationId,
    assistantMessageId,
    index,
  });
  return parsed.success ? parsed.data : undefined;
}

const ScoutCreateCustomIdSchema = z.strictObject({ intentId: z.uuid() });
export type ScoutCreateCustomId = z.infer<typeof ScoutCreateCustomIdSchema>;

/**
 * `scout:1:create:<intentId>` — confirm a creation Explore prepared.
 *
 * Carries only the intent id: the confirm path reads the guild, the payload
 * and the actor off the intent row and re-authorizes the clicker, so nothing
 * in the id is trusted.
 */
export function formatScoutCreateCustomId(input: ScoutCreateCustomId): string {
  const parsed = ScoutCreateCustomIdSchema.parse(input);
  return [
    SCOUT_COMPONENT_NAMESPACE,
    SCOUT_COMPONENT_VERSION,
    "create",
    parsed.intentId,
  ].join(":");
}

export function parseScoutCreateCustomId(
  raw: string,
): ScoutCreateCustomId | undefined {
  const [namespace, version, action, intentId, ...rest] = raw.split(":");
  if (
    namespace !== SCOUT_COMPONENT_NAMESPACE ||
    version !== SCOUT_COMPONENT_VERSION ||
    action !== "create" ||
    rest.length > 0
  ) {
    return undefined;
  }
  const parsed = ScoutCreateCustomIdSchema.safeParse({ intentId });
  return parsed.success ? parsed.data : undefined;
}
