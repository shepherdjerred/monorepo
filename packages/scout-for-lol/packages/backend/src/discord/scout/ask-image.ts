import { TRPCError } from "@trpc/server";
import type { DiscordAccountId } from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { storeExploreAttachment } from "#src/explore/attachments/storage.ts";
import {
  DiscordScreenshotSchema,
  readDiscordImage,
} from "#src/support/screenshots.ts";

/**
 * The optional image on `/scout ask`.
 *
 * Discord hands over a CDN link, not bytes. The link and its metadata are
 * checked before anything is fetched — only Discord's attachment hosts, an
 * image type Scout reads, at most 10 MiB — and the bytes are then stored
 * exactly like a web upload, so the question carries an ordinary attachment.
 */

/** The fields of a discord.js `Attachment` this needs. */
export type ScoutAskImage = {
  readonly name: string;
  readonly url: string;
  readonly contentType: string | null;
  readonly size: number;
};

export const ASK_IMAGE_REFUSAL =
  "Attach a PNG, JPEG or WebP image of 10 MiB or less.";

/** Whether the attachment is one Scout will fetch, before deferring. */
export function acceptableAskImage(image: ScoutAskImage): boolean {
  return DiscordScreenshotSchema.safeParse({
    name: image.name,
    contentType: image.contentType,
    size: image.size,
    url: image.url,
  }).success;
}

export async function storeAskImage(
  db: ExtendedPrismaClient,
  ownerId: DiscordAccountId,
  image: ScoutAskImage,
): Promise<
  { kind: "stored"; id: string } | { kind: "refused"; message: string }
> {
  const parsed = DiscordScreenshotSchema.safeParse({
    name: image.name,
    contentType: image.contentType,
    size: image.size,
    url: image.url,
  });
  if (!parsed.success) return { kind: "refused", message: ASK_IMAGE_REFUSAL };
  let bytes: Uint8Array;
  try {
    bytes = await readDiscordImage(
      parsed.data.url,
      AbortSignal.timeout(20_000),
    );
  } catch {
    return {
      kind: "refused",
      message: "Scout could not download that image from Discord. Try again.",
    };
  }
  try {
    const stored = await storeExploreAttachment(db, ownerId, {
      mediaType: parsed.data.contentType,
      bytes,
    });
    return { kind: "stored", id: stored.id };
  } catch (error) {
    // Bad bytes and upload limits are the asker's to fix; anything else is
    // a fault and propagates.
    if (!(error instanceof TRPCError)) throw error;
    return { kind: "refused", message: error.message };
  }
}
