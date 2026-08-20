import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

export const BUCKS_ASK_COMPONENT_NAMESPACE = "bbask";
const BUCKS_ASK_COMPONENT_VERSION = "1";
const BUCKS_ASK_PUBLISH_ACTION = "p";

export const BucksAskPublishCustomIdSchema = z.strictObject({
  askerDiscordId: DiscordAccountIdSchema,
});
export type BucksAskPublishCustomId = z.infer<
  typeof BucksAskPublishCustomIdSchema
>;

export function formatBucksAskPublishCustomId(
  input: BucksAskPublishCustomId,
): string {
  const parsed = BucksAskPublishCustomIdSchema.parse(input);
  const customId = [
    BUCKS_ASK_COMPONENT_NAMESPACE,
    BUCKS_ASK_COMPONENT_VERSION,
    BUCKS_ASK_PUBLISH_ACTION,
    parsed.askerDiscordId,
  ].join(":");
  if (customId.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Bryan Bucks ask custom ID is ${customId.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit`,
    );
  }
  return customId;
}

export function parseBucksAskPublishCustomId(
  raw: string,
): BucksAskPublishCustomId | undefined {
  const segments = raw.split(":");
  if (segments.length !== 4) return undefined;
  const [namespace, version, action, askerDiscordId] = segments;
  if (
    namespace !== BUCKS_ASK_COMPONENT_NAMESPACE ||
    version !== BUCKS_ASK_COMPONENT_VERSION ||
    action !== BUCKS_ASK_PUBLISH_ACTION
  ) {
    return undefined;
  }
  const parsed = BucksAskPublishCustomIdSchema.safeParse({ askerDiscordId });
  return parsed.success ? parsed.data : undefined;
}

export function isBucksAskCustomId(raw: string): boolean {
  return raw.startsWith(`${BUCKS_ASK_COMPONENT_NAMESPACE}:`);
}
