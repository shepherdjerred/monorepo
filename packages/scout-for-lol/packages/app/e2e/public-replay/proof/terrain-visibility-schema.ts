import { z } from "zod";

export const RecordedTerrainVisibilitySchema = z.object({
  omittedMeshControllerIds: z.array(z.number().int().positive()).optional(),
  unresolvedWindows: z
    .array(
      z.object({
        controllerId: z.number().int().positive(),
        startSeconds: z.number().nonnegative(),
        endSeconds: z.number().positive(),
      }),
    )
    .optional(),
  tracks: z.array(
    z.object({
      controllerId: z.number().int().positive(),
      points: z
        .array(z.tuple([z.number().nonnegative(), z.boolean()]))
        .nonempty(),
    }),
  ),
});
