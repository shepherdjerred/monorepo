import { z } from "zod";

/** Sync and health fields shared by ArgoCD release and observation contracts. */
export const ArgoApplicationStatusSchema = z.object({
  sync: z
    .object({ status: z.string(), revision: z.string().optional() })
    .optional(),
  health: z.object({ status: z.string() }).optional(),
});
