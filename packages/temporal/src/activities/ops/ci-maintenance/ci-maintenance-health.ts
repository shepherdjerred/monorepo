import * as k8s from "@kubernetes/client-node";
import { Context } from "@temporalio/activity";
import { z } from "zod";
import { maintenanceGithub } from "#activities/maintenance/ci-maintenance-client.ts";
import {
  readCiWorkspaceGoldenSelection,
  type GoldenSelection,
} from "#activities/maintenance/ci-workspace-golden.ts";
import {
  ciMaintenanceDispatchState,
  ciWorkspaceGoldenRefreshState,
  type MaintenanceFlagState,
} from "#config/ci-maintenance.ts";
import {
  createAlertmanagerPoster,
  type AlertmanagerAlert,
  type AlertPoster,
} from "#lib/alertmanager.ts";
import {
  buildCiMaintenanceAlerts,
  coordinatorInspectionStale,
  isFiringAlert,
  type CiMaintenanceHealthState,
  type GoldenCommit,
  type GoldenFreshness,
} from "#shared/alerts/ci-maintenance-alert.ts";
import { CiMaintenanceKindSchema } from "#shared/ci-maintenance.ts";
import { readProdCiMaintenanceMemo } from "./ci-maintenance-ops.ts";

const REPO = { owner: "shepherdjerred", repo: "monorepo" };

const BlockedSchema = z.object({
  requestId: z.string().min(1),
  reason: z.string().min(1),
  blockedAt: z.iso.datetime().optional(),
});
/** The coordinator's `ciMaintenance` memo, as far as its health alerts read it. */
const CiMaintenanceHealthMemoSchema = z.object({
  blocked: z.partialRecord(CiMaintenanceKindSchema, BlockedSchema),
  pending: z
    .object({
      kind: CiMaintenanceKindSchema,
      requestId: z.string().min(1),
      pipeline: z.number().int().positive().nullable(),
      queuedSince: z.iso.datetime().optional(),
      startedAt: z.iso.datetime().optional(),
      cancelRequestedAt: z.iso.datetime().optional(),
      lastQueueCheck: z
        .enum(["waiting", "not-queued", "canceled", "uncertain", "failed"])
        .optional(),
    })
    .nullable(),
  inspectedAt: z.iso.datetime().optional(),
});

export function parseCiMaintenanceHealthMemo(
  memo: unknown,
): CiMaintenanceHealthState | null {
  return memo === null || memo === undefined
    ? null
    : CiMaintenanceHealthMemoSchema.parse(memo);
}

export type CiMaintenanceHealthDeps = {
  readMemo: () => Promise<unknown>;
  dispatchState: () => Promise<MaintenanceFlagState>;
  goldenRefreshState: () => Promise<MaintenanceFlagState>;
  readGoldenSelection: () => Promise<GoldenSelection | null>;
  /** The commit a ref (main or a SHA) names, with its committer date. */
  readCommit: (ref: string) => Promise<GoldenCommit>;
  post: AlertPoster;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
};

/**
 * A stale inspection is read again this much later before it pages. The tick
 * wakes the coordinator and publishes health at once, so the first read can
 * predate the inspection that same wake triggers, as when dispatch is turned
 * back on after a pause.
 */
const INSPECTION_CONFIRM_MS = 60_000;

async function readCoordinatorState(deps: CiMaintenanceHealthDeps) {
  return parseCiMaintenanceHealthMemo(await deps.readMemo());
}

/** Undefined while the golden refresh flag is unknown: the occurrence is left out, not resolved. */
async function inspectGoldenFreshness(
  deps: CiMaintenanceHealthDeps,
): Promise<GoldenFreshness | undefined> {
  const flag = await deps.goldenRefreshState();
  if (flag === "unknown") return undefined;
  if (flag === "off") return { status: "disabled" };
  const [selection, main] = await Promise.all([
    deps.readGoldenSelection(),
    deps.readCommit("main"),
  ]);
  if (selection === null) return { status: "unselected" };
  return {
    status: "selected",
    snapshot: selection.snapshot,
    snapshotCreatedAt: selection.snapshotCreatedAt,
    source:
      selection.source === undefined
        ? undefined
        : await deps.readCommit(selection.source),
    main,
  };
}

type CiMaintenanceHealthSummary = {
  /** `alertname` or `alertname:stream` of every firing occurrence. */
  firing: string[];
  /** Sources left out because the flag that scopes them is unknown. */
  unknown: string[];
};

function alertKey(alert: AlertmanagerAlert) {
  return [alert.labels["alertname"], alert.labels["stream"]]
    .filter((part) => part !== undefined)
    .join(":");
}

function settledValue<T>(result: PromiseSettledResult<T>): T | undefined {
  return result.status === "fulfilled" ? result.value : undefined;
}

/**
 * Reads coordinator and golden-workspace health and publishes every
 * occurrence it could evaluate. A source that fails leaves out only its own
 * occurrences, which keep their last state until their TTL; the rest still
 * publish. The failure is then raised, so the activity retries it and a
 * source that keeps failing fails the tick for temporal-failure-watch.
 */
export async function publishCiMaintenanceHealthWith(
  deps: CiMaintenanceHealthDeps,
): Promise<CiMaintenanceHealthSummary> {
  let now = deps.now();
  const [first, dispatch, golden] = await Promise.allSettled([
    readCoordinatorState(deps),
    deps.dispatchState(),
    inspectGoldenFreshness(deps),
  ]);
  const dispatchState = settledValue(dispatch);
  let memo = first;
  if (
    dispatchState === "on" &&
    memo.status === "fulfilled" &&
    coordinatorInspectionStale(memo.value, now)
  ) {
    // Two consecutive stale reads, a minute apart, before paging.
    await deps.sleep(INSPECTION_CONFIRM_MS);
    [memo] = await Promise.allSettled([readCoordinatorState(deps)]);
    now = deps.now();
  }
  const goldenState = settledValue(golden);
  const alerts = buildCiMaintenanceAlerts(
    {
      ...(memo.status === "fulfilled"
        ? { coordinator: { state: memo.value, dispatch: dispatchState } }
        : {}),
      ...(goldenState === undefined ? {} : { golden: goldenState }),
    },
    now,
  );
  if (alerts.length > 0) await deps.post(alerts);
  const failures = Object.entries({ memo, dispatch, golden }).flatMap(
    ([source, result]) =>
      result.status === "rejected"
        ? [
            `${source}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          ]
        : [],
  );
  if (failures.length > 0)
    throw new Error(
      `CI maintenance health could not read ${failures.join("; ")}; published the other occurrences`,
    );
  return {
    firing: alerts
      .filter((alert) => isFiringAlert(alert))
      .map((alert) => alertKey(alert)),
    unknown: [
      ...(dispatchState === "unknown" ? ["dispatch"] : []),
      ...(goldenState === undefined && golden.status === "fulfilled"
        ? ["golden"]
        : []),
    ],
  };
}

const CommitDateSchema = z.object({
  committer: z.object({ date: z.iso.datetime({ offset: true }) }),
});

/** One installation token per publish, shared by its commit reads. */
function githubCommitReader(): (ref: string) => Promise<GoldenCommit> {
  let github: ReturnType<typeof maintenanceGithub> | undefined;
  return async (ref) => {
    github ??= maintenanceGithub();
    const client = await github;
    const response = await client.rest.repos.listCommits({
      ...REPO,
      sha: ref,
      per_page: 1,
    });
    const commit = response.data[0];
    if (commit === undefined) throw new Error(`GitHub has no commit ${ref}`);
    return {
      sha: commit.sha,
      committedAt: new Date(
        CommitDateSchema.parse(commit.commit).committer.date,
      ),
    };
  };
}

function inClusterGoldenSelection(): Promise<GoldenSelection | null> {
  const kc = new k8s.KubeConfig();
  kc.loadFromCluster();
  return readCiWorkspaceGoldenSelection(
    kc.makeApiClient(k8s.CustomObjectsApi),
    kc.makeApiClient(k8s.CoreV1Api),
  );
}

/**
 * Runs on the `ops` queue: the infra worker holds the golden ConfigMap and
 * snapshot read grant, Alertmanager, GitHub App, and Temporal read access,
 * and its `ops` slots never wait behind long infra automation.
 */
export const ciMaintenanceHealthActivities = {
  async publishCiMaintenanceHealth(): Promise<CiMaintenanceHealthSummary> {
    const alertmanagerUrl = Bun.env["ALERTMANAGER_URL"];
    if (alertmanagerUrl === undefined || alertmanagerUrl === "")
      throw new Error(
        "ALERTMANAGER_URL is required to publish CI maintenance health",
      );
    return await publishCiMaintenanceHealthWith({
      readMemo: () => readProdCiMaintenanceMemo(),
      dispatchState: ciMaintenanceDispatchState,
      goldenRefreshState: ciWorkspaceGoldenRefreshState,
      readGoldenSelection: inClusterGoldenSelection,
      readCommit: githubCommitReader(),
      post: createAlertmanagerPoster(alertmanagerUrl),
      now: () => new Date(),
      sleep: (ms) => Context.current().sleep(ms),
    });
  },
};

export type CiMaintenanceHealthActivities =
  typeof ciMaintenanceHealthActivities;
