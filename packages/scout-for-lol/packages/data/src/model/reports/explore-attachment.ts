import { z } from "zod";

/** Images one Explore question may carry. */
export const EXPLORE_MAX_ATTACHMENTS = 4;

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
