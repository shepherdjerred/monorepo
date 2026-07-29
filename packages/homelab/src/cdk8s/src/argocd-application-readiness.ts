import { z } from "zod";

const ApplicationStatusSchema = z.object({
  status: z
    .object({
      sync: z
        .object({ status: z.string(), revision: z.string().optional() })
        .optional(),
      health: z.object({ status: z.string() }).optional(),
      operationState: z
        .object({ phase: z.string(), message: z.string().optional() })
        .optional(),
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
  const operationPhase = status?.operationState?.phase;
  const operationReady =
    operationPhase === undefined || operationPhase === "Succeeded";
  return {
    sync: syncValue,
    health: healthValue,
    ready:
      operationReady &&
      healthValue === "Healthy" &&
      (!requireSynced || syncValue === "Synced"),
  };
}

const ApplicationListItemSchema = z.object({
  metadata: z.object({ name: z.string() }),
  status: z
    .object({
      sync: z
        .object({
          status: z.string(),
          revision: z.string().optional(),
        })
        .optional(),
      health: z.object({ status: z.string() }).optional(),
      operationState: z
        .object({
          phase: z.string(),
          message: z.string().optional(),
        })
        .optional(),
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
});

const ApplicationListSchema = z.object({
  items: z.array(ApplicationListItemSchema).nullish(),
});

type ApplicationListItem = z.infer<typeof ApplicationListItemSchema>;

function operationIsReady(phase: string | undefined): boolean {
  return phase === undefined || phase === "Succeeded";
}

function isSyncedAndHealthy(sync: string, health: string): boolean {
  return sync === "Synced" && health === "Healthy";
}

function offendingResources(item: ApplicationListItem): string[] {
  return (item.status?.resources ?? [])
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
}

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
    const operationPhase = item.status?.operationState?.phase;
    const ready =
      operationIsReady(operationPhase) &&
      health === "Healthy" &&
      (!requireSynced || sync === "Synced");
    if (ready) {
      continue;
    }
    const offenders = offendingResources(item);
    const operation = operationIsReady(operationPhase)
      ? ""
      : ` Operation=${operationPhase ?? "?"}`;
    const suffix = offenders.length > 0 ? ` — ${offenders.join(", ")}` : "";
    lines.push(
      `${item.metadata.name}: Sync=${sync || "?"} Health=${health || "?"}${operation}${suffix}`,
    );
  }
  return lines;
}

export type ExpectedApplicationRevision = {
  readonly name: string;
  readonly revision?: string;
};

export type ReleaseTreeReadiness = {
  readonly ready: boolean;
  readonly failures: readonly string[];
};

function expectedApplicationFailure(
  wanted: ExpectedApplicationRevision,
  item: ApplicationListItem | undefined,
): string | undefined {
  if (item === undefined) {
    return `${wanted.name}: missing`;
  }
  const sync = item.status?.sync?.status ?? "";
  const health = item.status?.health?.status ?? "";
  const revision = item.status?.sync?.revision;
  const operationPhase = item.status?.operationState?.phase;
  if (!isSyncedAndHealthy(sync, health)) {
    return `${wanted.name}: Sync=${sync || "?"} Health=${health || "?"}`;
  }
  if (!operationIsReady(operationPhase)) {
    return `${wanted.name}: Operation=${operationPhase ?? "?"}`;
  }
  if (wanted.revision !== undefined && revision !== wanted.revision) {
    return `${wanted.name}: Revision=${revision ?? "?"} Expected=${wanted.revision}`;
  }
  return undefined;
}

export function releaseTreeReadiness(
  list: unknown,
  expected: readonly ExpectedApplicationRevision[],
): ReleaseTreeReadiness {
  const items = ApplicationListSchema.parse(list).items ?? [];
  const byName = new Map(items.map((item) => [item.metadata.name, item]));
  const failures: string[] = [];
  for (const wanted of expected) {
    if (wanted.name === "apps") {
      continue;
    }
    const failure = expectedApplicationFailure(wanted, byName.get(wanted.name));
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  return { ready: failures.length === 0, failures };
}
