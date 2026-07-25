import { z } from "zod";

const ApplicationStatusSchema = z.object({
  status: z
    .object({
      sync: z.object({ status: z.string() }).optional(),
      health: z.object({ status: z.string() }).optional(),
    })
    .optional(),
});

export type ApplicationReadiness = {
  sync: string;
  health: string;
  ready: boolean;
};

/** Read ArgoCD's sync/health state and evaluate the requested readiness gate. */
export function applicationReadiness(
  app: Record<string, unknown>,
  requireSynced: boolean,
): ApplicationReadiness {
  const status = ApplicationStatusSchema.parse(app).status;
  const syncValue = status?.sync?.status ?? "";
  const healthValue = status?.health?.status ?? "";
  return {
    sync: syncValue,
    health: healthValue,
    ready:
      healthValue === "Healthy" && (!requireSynced || syncValue === "Synced"),
  };
}
