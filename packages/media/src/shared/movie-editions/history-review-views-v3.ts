import { z } from "zod";
import {
  MovieEditionScopeSchema,
  MovieEditionDefinitionRefSchema,
} from "./registry.ts";

export const MovieHistoryDiscoveryV3Schema = z.strictObject({
  scope: MovieEditionScopeSchema.optional(),
});
export const MovieHistoryPendingV3Schema = z.strictObject({
  reviews: z
    .array(
      z.strictObject({
        id: z.uuid(),
        version: z.int().nonnegative(),
        scope: MovieEditionScopeSchema,
        definition: MovieEditionDefinitionRefSchema,
        title: z.string(),
        expiresAt: z.iso.datetime(),
        responded: z.boolean(),
      }),
    )
    .max(100),
});
