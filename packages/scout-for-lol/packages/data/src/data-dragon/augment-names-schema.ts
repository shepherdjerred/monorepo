import { z } from "zod";

export const AugmentNameCatalogSchema = z.strictObject({
  sourceVersions: z
    .array(z.string().regex(/^\d+\.\d+$/))
    .min(1)
    .refine((versions) => new Set(versions).size === versions.length),
  augments: z
    .record(
      z.string().regex(/^[1-9]\d*$/),
      z.strictObject({
        apiName: z.string().min(1).regex(/\S/),
        name: z.string().min(1).regex(/\S/),
      }),
    )
    .refine((augments) => Object.keys(augments).length > 0),
});

export type AugmentNameCatalog = z.infer<typeof AugmentNameCatalogSchema>;
