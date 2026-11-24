import { Context } from "@temporalio/activity";
import { WorkflowNotFoundError, type Client } from "@temporalio/client";
import type { Link, SignalInput } from "@shepherdjerred/ops-model/snapshot.ts";
import { z } from "zod";
import { createTemporalReadClient } from "#client";
import { truncate } from "#activities/ops/ops-types.ts";
import { withScheduleReads } from "#activities/ops/temporal-schedule-reads.ts";
import {
  CI_MAINTENANCE_ID,
  CI_MAINTENANCE_KINDS,
  type CiMaintenanceKind,
} from "#shared/ci-maintenance.ts";

/** Wait one full 5-minute maintenance schedule interval before paging on a block. */
export const CI_MAINTENANCE_BLOCKED_GRACE_MS = 5 * 60_000;

const DEFAULT_WOODPECKER_BASE_URL = "https://woodpecker.sjer.red";
const DEFAULT_WOODPECKER_REPO_ID = 1;

const BlockedMaintenanceEntrySchema = z.object({
  requestId: z.string().min(1),
  reason: z.string().min(1),
  blockedAt: z.iso.datetime().optional(),
});
type BlockedMaintenanceEntry = z.infer<typeof BlockedMaintenanceEntrySchema>;

const CiMaintenanceMemoSchema = z.object({
  blocked: z
    .object({
      "release-notes": BlockedMaintenanceEntrySchema.optional(),
      "ci-images": BlockedMaintenanceEntrySchema.optional(),
      "workspace-seeds": BlockedMaintenanceEntrySchema.optional(),
      "workspace-golden": BlockedMaintenanceEntrySchema.optional(),
    })
    .default({}),
});

export type CiMaintenanceSignalOptions = {
  now: Date;
  woodpeckerBaseUrl?: string;
  woodpeckerRepoId?: number;
};

export type CiMaintenanceCoordinatorReader = () => Promise<unknown>;

export function parseBlockedPipelineNumber(reason: string): number | undefined {
  const match = /^Pipeline (\d+)\b/u.exec(reason);
  if (match?.[1] === undefined) return undefined;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function coordinatorWorkflowLink(): Link {
  return {
    kind: "temporal",
    label: "Coordinator workflow",
    url: `https://temporal-ui.tailnet-1a49.ts.net/namespaces/prod/workflows/${encodeURIComponent(CI_MAINTENANCE_ID)}`,
  };
}

function woodpeckerPipelineLink(
  pipeline: number,
  baseUrl: string,
  repoId: number,
): Link {
  return {
    kind: "woodpecker",
    label: `Pipeline #${String(pipeline)}`,
    url: new URL(
      `/repos/${String(repoId)}/pipeline/${String(pipeline)}`,
      baseUrl,
    ).toString(),
  };
}

function isWithinGraceWindow(
  blockedAt: string | undefined,
  now: Date,
): boolean {
  return (
    blockedAt !== undefined &&
    now.getTime() - Date.parse(blockedAt) <= CI_MAINTENANCE_BLOCKED_GRACE_MS
  );
}

function buildBlockedSignal(
  kind: CiMaintenanceKind,
  entry: BlockedMaintenanceEntry,
  woodpeckerBaseUrl: string,
  woodpeckerRepoId: number,
): SignalInput {
  const pipeline = parseBlockedPipelineNumber(entry.reason);
  const links: Link[] =
    pipeline === undefined
      ? [coordinatorWorkflowLink()]
      : [
          woodpeckerPipelineLink(pipeline, woodpeckerBaseUrl, woodpeckerRepoId),
          coordinatorWorkflowLink(),
        ];
  return {
    id: `temporal:ci-maintenance:${kind}:blocked`,
    source: "temporal",
    section: "maintenance",
    kind: "ci-maintenance-blocked",
    severity: "warning",
    needsMe: true,
    title:
      pipeline === undefined
        ? `CI maintenance ${kind} is blocked`
        : `CI maintenance ${kind} blocked by pipeline #${String(pipeline)}`,
    detail: truncate(entry.reason, 300),
    ...(entry.blockedAt === undefined ? {} : { since: entry.blockedAt }),
    attributes: {
      maintenanceKind: kind,
      requestId: entry.requestId,
      temporalNamespace: "prod",
      workflowId: CI_MAINTENANCE_ID,
      ...(pipeline === undefined ? {} : { pipeline }),
      ...(entry.blockedAt === undefined ? {} : { blockedAt: entry.blockedAt }),
    },
    links,
  };
}

export function mapCiMaintenanceBlockedSignals(
  rawMemo: unknown,
  options: CiMaintenanceSignalOptions,
): SignalInput[] {
  if (rawMemo === null || rawMemo === undefined) return [];
  const parsed = CiMaintenanceMemoSchema.parse(rawMemo);
  const woodpeckerBaseUrl =
    options.woodpeckerBaseUrl ?? DEFAULT_WOODPECKER_BASE_URL;
  const woodpeckerRepoId =
    options.woodpeckerRepoId ?? DEFAULT_WOODPECKER_REPO_ID;

  const signals: SignalInput[] = [];
  for (const kind of CI_MAINTENANCE_KINDS) {
    const entry = parsed.blocked[kind];
    if (
      entry === undefined ||
      isWithinGraceWindow(entry.blockedAt, options.now)
    )
      continue;
    signals.push(
      buildBlockedSignal(kind, entry, woodpeckerBaseUrl, woodpeckerRepoId),
    );
  }
  return signals;
}

function activityCancellationSignal(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

export async function describeCiMaintenanceMemo(
  describeWorkflow: () => Promise<{ memo?: Record<string, unknown> }>,
): Promise<unknown> {
  try {
    const description = await describeWorkflow();
    return description.memo?.["ciMaintenance"] ?? null;
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) return null;
    throw error;
  }
}

export async function readProdCiMaintenanceMemo(
  getClient: () => Promise<Client> = () => createTemporalReadClient("prod"),
): Promise<unknown> {
  const signal = activityCancellationSignal();
  return await withScheduleReads(
    async (scope) => {
      const client = await scope.read(getClient);
      return await scope.read(() =>
        client.connection.withAbortSignal(scope.signal, () =>
          client.connection.withDeadline(scope.deadline, () =>
            describeCiMaintenanceMemo(() =>
              client.workflow.getHandle(CI_MAINTENANCE_ID).describe(),
            ),
          ),
        ),
      );
    },
    signal === undefined ? {} : { signal },
  );
}

export async function collectCiMaintenanceBlockedSignals(
  options: CiMaintenanceSignalOptions,
  readMemo: CiMaintenanceCoordinatorReader = readProdCiMaintenanceMemo,
): Promise<SignalInput[]> {
  const memo = await readMemo();
  return mapCiMaintenanceBlockedSignals(memo, options);
}
