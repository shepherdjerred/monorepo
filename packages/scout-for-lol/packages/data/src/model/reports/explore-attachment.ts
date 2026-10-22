import { z } from "zod";

/** Images one Explore question may carry. */
export const EXPLORE_MAX_ATTACHMENTS = 4;

/**
 * How long an unsent upload is held for the composer showing it. A composer
 * renews the hold well inside this while it is open; one that stops (a
 * closed or refreshed tab) lets the hold lapse, and only then may the upload
 * be reclaimed to free its slot.
 */
export const EXPLORE_ATTACHMENT_HOLD_MS = 15 * 60_000;

/** The image types Explore stores and sends to the model. */
export const ExploreAttachmentMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** An image attached to a question; its bytes are fetched by id. */
export const ExploreAttachmentSchema = z
  .object({ id: z.uuid(), mediaType: ExploreAttachmentMediaTypeSchema })
  .strict();
export type ExploreAttachment = z.infer<typeof ExploreAttachmentSchema>;
