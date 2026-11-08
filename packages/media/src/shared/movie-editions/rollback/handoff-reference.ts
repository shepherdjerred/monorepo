import { z } from "zod";
import { MovieEditionHashSchema } from "#shared/movie-editions/registry.ts";

export const MovieRollbackHandoffRefV1Schema = z.strictObject({
  eventId: z.uuid(),
  handoffHash: MovieEditionHashSchema,
});
