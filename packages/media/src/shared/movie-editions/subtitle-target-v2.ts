import { z } from "zod";
import { SubtitleTargetListSchema } from "#shared/admin.ts";
import { MovieEditionScopeSchema } from "./registry.ts";

/** Owner-only current caption selection. Paths, credential/source material and file plans stay private. */
export const MovieSubtitleTargetV2Schema = SubtitleTargetListSchema.element
  .strict()
  .extend({
    schemaVersion: z.literal(2),
    scope: MovieEditionScopeSchema,
    editionLabel: z.string().min(1),
  });
export type MovieSubtitleTargetV2 = z.infer<typeof MovieSubtitleTargetV2Schema>;
