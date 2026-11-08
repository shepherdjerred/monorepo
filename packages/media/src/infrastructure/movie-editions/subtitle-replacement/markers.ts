import { z } from "zod";

/** Read only known ancestry markers; receipt and source checks stay with callers. */
export const MovieCaptionMarkersSchema = z.object({
  movieReplacementV2: z
    .strictObject({
      schemaVersion: z.literal(2),
      replacementId: z.uuid(),
    })
    .optional(),
  movieInstallationV4: z
    .strictObject({
      schemaVersion: z.literal(4),
      operationId: z.uuid(),
    })
    .optional(),
});
