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

const ApplicationListSchema = z.object({
  items: z
    .array(
      z.object({
        metadata: z.object({ name: z.string() }),
        status: z
          .object({
            sync: z.object({ status: z.string() }).optional(),
            health: z.object({ status: z.string() }).optional(),
            resources: z
              .array(
                z.object({
                  kind: z.string().optional(),
                  name: z.string().optional(),
                  status: z.string().optional(),
                  health: z
                    .object({
                      status: z.string().optional(),
                      message: z.string().optional(),
                    })
                    .optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .nullish(),
});

/**
 * One line per application failing the readiness gate, with up to three of
 * its offending resources. Consumed by the health-wait timeout path so a
 * failed wait names the stuck app (during the build 6296–6333 incident the
 * bare "apps did not become Synced/Healthy" message forced manual kubectl
 * archaeology to find the turbo-cache orphan / mario-kart crash-loop).
 */
export function unreadyApplicationSummaries(
  list: unknown,
  requireSynced: boolean,
): string[] {
  const items = ApplicationListSchema.parse(list).items ?? [];
  const lines: string[] = [];
  for (const item of items) {
    const sync = item.status?.sync?.status ?? "";
    const health = item.status?.health?.status ?? "";
    const ready = health === "Healthy" && (!requireSynced || sync === "Synced");
    if (ready) {
      continue;
    }
    const offenders = (item.status?.resources ?? [])
      .filter(
        (resource) =>
          (resource.status !== undefined && resource.status !== "Synced") ||
          (resource.health?.status !== undefined &&
            resource.health.status !== "Healthy"),
      )
      .slice(0, 3)
      .map((resource) => {
        const ref = `${resource.kind ?? "?"}/${resource.name ?? "?"}`;
        const message = resource.health?.message;
        return message === undefined || message.length === 0
          ? ref
          : `${ref} (${message})`;
      });
    const suffix = offenders.length > 0 ? ` — ${offenders.join(", ")}` : "";
    lines.push(
      `${item.metadata.name}: Sync=${sync || "?"} Health=${health || "?"}${suffix}`,
    );
  }
  return lines;
}
