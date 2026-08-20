import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

export const PEEK_PASS_COMPONENT_NAMESPACE = "bbpass";
export const PEEK_PASS_COMPONENT_VERSION = "1";

const PeekPassCustomIdSchema = z.strictObject({
  action: z.literal("b"),
  ownerId: DiscordAccountIdSchema,
  serverId: DiscordGuildIdSchema,
  quotedAtMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quotedPrice: z.number().int().positive(),
});

export type PeekPassCustomId = z.infer<typeof PeekPassCustomIdSchema>;

export function formatPeekPassCustomId(input: PeekPassCustomId): string {
  const parsed = PeekPassCustomIdSchema.parse(input);
  const customId = [
    PEEK_PASS_COMPONENT_NAMESPACE,
    PEEK_PASS_COMPONENT_VERSION,
    parsed.action,
    parsed.ownerId,
    parsed.serverId,
    parsed.quotedAtMs.toString(),
    parsed.quotedPrice.toString(),
  ].join(":");
  if (customId.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Peek-pass custom ID exceeds Discord's ${MAX_CUSTOM_ID_LENGTH.toString()}-character limit`,
    );
  }
  return customId;
}

const EXPECTED_SEGMENTS = 7;

export function parsePeekPassCustomId(
  raw: string,
): PeekPassCustomId | undefined {
  const segments = raw.split(":");
  if (segments.length !== EXPECTED_SEGMENTS) {
    return undefined;
  }
  const [namespace, version, action, ownerId, serverId, quotedAt, price] =
    segments;
  if (
    namespace !== PEEK_PASS_COMPONENT_NAMESPACE ||
    version !== PEEK_PASS_COMPONENT_VERSION
  ) {
    return undefined;
  }
  const parsed = PeekPassCustomIdSchema.safeParse({
    action,
    ownerId,
    serverId,
    quotedAtMs: Number(quotedAt),
    quotedPrice: Number(price),
  });
  return parsed.success ? parsed.data : undefined;
}

export function isPeekPassCustomId(raw: string): boolean {
  return raw.startsWith(`${PEEK_PASS_COMPONENT_NAMESPACE}:`);
}
