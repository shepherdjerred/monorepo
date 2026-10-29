import { z } from "zod";

// Historical cleanup parser: retain its original shape and stripping behavior.
export const UpgradeCleanupPlanSchema = z.object({
  libraryKind: z.enum(["movies", "tv"]),
  assetVersion: z.number().int(),
  successorChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaIds: z.array(z.string()).min(1),
  files: z
    .array(
      z.object({
        location: z.enum(["rollback", "quarantine"]),
        id: z.string().regex(/^[\w-]{1,100}$/u),
        path: z.string(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/u),
        subtitleId: z.string().nullable(),
      }),
    )
    .min(1),
});
export type UpgradeCleanupPlan = z.infer<typeof UpgradeCleanupPlanSchema>;
