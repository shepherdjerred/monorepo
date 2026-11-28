import { z } from "zod";
import { capture } from "#lib/ci/process.ts";
import {
  buildPassthroughInvocation,
  lookupExecutable,
} from "#lib/passthrough.ts";
import { requiredCredentialsFor } from "#lib/credential-commands.ts";
import { resolveCredentials } from "#lib/credentials.ts";

// Mirrors CI_MAINTENANCE_ID and CI_MAINTENANCE_KINDS in
// packages/temporal/src/shared/ci-maintenance.ts, which toolkit does not import.
export const CI_MAINTENANCE_WORKFLOW_ID = "ci-maintenance-coordinator";
export const CI_MAINTENANCE_NAMESPACE = "prod";
export const CI_MAINTENANCE_KINDS = [
  "release-notes",
  "ci-images",
  "workspace-seeds",
  "workspace-golden",
] as const;
export type CiMaintenanceKind = (typeof CI_MAINTENANCE_KINDS)[number];
export const MAINTENANCE_RETRY_SIGNAL = "maintenanceRetry";

const BlockedSchema = z
  .object({ requestId: z.string().min(1), reason: z.string() })
  .loose();
const PendingSchema = z
  .object({
    kind: z.string(),
    requestId: z.string(),
    pipeline: z.number().nullable(),
  })
  .loose();
/** The coordinator's `ciMaintenance` memo; loose because Temporal owns it. */
const MemoSchema = z
  .object({
    blocked: z.record(z.string(), BlockedSchema).default({}),
    pending: PendingSchema.nullable().default(null),
    observation: z.string().optional(),
  })
  .loose();
export type CiMaintenanceMemo = z.infer<typeof MemoSchema>;
/** `temporal workflow describe --output json`, down to the decoded memo. */
const DescribeSchema = z.object({
  workflowExecutionInfo: z.object({
    status: z.string(),
    memo: z
      .object({ fields: z.object({ ciMaintenance: MemoSchema.optional() }) })
      .optional(),
  }),
});

export type RetryPlan =
  | {
      readonly action: "send";
      readonly kind: CiMaintenanceKind;
      readonly requestId: string;
      readonly blockedReason: string;
    }
  | {
      readonly action: "refuse";
      readonly kind: CiMaintenanceKind;
      readonly why: string;
    };

/**
 * A retry names the exact diagnosed request. The coordinator drops it while a
 * submission is pending, so an unsendable retry is reported and never sent.
 */
export function planMaintenanceRetry(
  memo: CiMaintenanceMemo | null,
  kind: CiMaintenanceKind,
): RetryPlan {
  if (memo === null)
    return {
      action: "refuse",
      kind,
      why: "The coordinator has no ciMaintenance memo yet.",
    };
  const blocked = memo.blocked[kind];
  if (blocked === undefined)
    return {
      action: "refuse",
      kind,
      why: `${kind} is not blocked. Blocked streams: ${Object.keys(memo.blocked).join(", ") || "none"}.`,
    };
  if (memo.pending !== null)
    return {
      action: "refuse",
      kind,
      why: `${memo.pending.kind} request ${memo.pending.requestId} is pending${memo.pending.pipeline === null ? " without a pipeline" : ` as pipeline ${String(memo.pending.pipeline)}`}; the coordinator ignores a retry until it settles. Reconcile or cancel that pipeline first.`,
    };
  return {
    action: "send",
    kind,
    requestId: blocked.requestId,
    blockedReason: blocked.reason,
  };
}

async function temporal(
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  await resolveCredentials(
    requiredCredentialsFor("temporal", undefined, Bun.env, args),
  );
  const invocation = buildPassthroughInvocation("temporal", args, Bun.env);
  const executable =
    invocation === null
      ? null
      : lookupExecutable(invocation.executable, invocation.env["PATH"]);
  if (invocation === null || executable === null)
    throw new Error("The temporal CLI is not installed");
  return capture([executable, ...invocation.args], signal, invocation.env);
}

const COORDINATOR = [
  "--workflow-id",
  CI_MAINTENANCE_WORKFLOW_ID,
  "--namespace",
  CI_MAINTENANCE_NAMESPACE,
];

/** The running coordinator's memo, or null while it has none. */
export async function readCiMaintenanceMemo(
  signal?: AbortSignal,
): Promise<CiMaintenanceMemo | null> {
  const description = DescribeSchema.parse(
    JSON.parse(
      await temporal(
        ["workflow", "describe", ...COORDINATOR, "--output", "json"],
        signal,
      ),
    ),
  );
  if (
    description.workflowExecutionInfo.status !==
    "WORKFLOW_EXECUTION_STATUS_RUNNING"
  )
    throw new Error(
      `${CI_MAINTENANCE_WORKFLOW_ID} is ${description.workflowExecutionInfo.status}, not running`,
    );
  return description.workflowExecutionInfo.memo?.fields.ciMaintenance ?? null;
}

export async function sendMaintenanceRetry(
  plan: Extract<RetryPlan, { action: "send" }>,
  signal?: AbortSignal,
): Promise<void> {
  await temporal(
    [
      "workflow",
      "signal",
      ...COORDINATOR,
      "--name",
      MAINTENANCE_RETRY_SIGNAL,
      "--input",
      JSON.stringify({ kind: plan.kind, requestId: plan.requestId }),
    ],
    signal,
  );
}

export type RetryDeps = {
  readonly read: (signal?: AbortSignal) => Promise<CiMaintenanceMemo | null>;
  readonly send: (
    plan: Extract<RetryPlan, { action: "send" }>,
    signal?: AbortSignal,
  ) => Promise<void>;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

const LIVE: RetryDeps = {
  read: readCiMaintenanceMemo,
  send: sendMaintenanceRetry,
  sleep: (milliseconds) => Bun.sleep(milliseconds),
};

export type RetryReport = {
  readonly kind: CiMaintenanceKind;
  readonly dryRun: boolean;
  readonly plan: RetryPlan;
  readonly sent: boolean;
  /** After a send: whether the coordinator cleared the block (read back). */
  readonly blockCleared: boolean | null;
  readonly observation: string | null;
};

const READ_BACK_ATTEMPTS = 15;
const READ_BACK_INTERVAL_MS = 2000;

/**
 * Read the coordinator memo and, with `apply`, send `maintenanceRetry` for the
 * diagnosed blocked request, then poll the memo until the block clears. The
 * poll ends on that evidence, or after a bounded number of reads.
 */
export async function maintenanceRetry(
  kind: CiMaintenanceKind,
  apply: boolean,
  signal?: AbortSignal,
  deps: RetryDeps = LIVE,
): Promise<RetryReport> {
  const memo = await deps.read(signal);
  const plan = planMaintenanceRetry(memo, kind);
  if (!apply || plan.action === "refuse")
    return {
      kind,
      dryRun: !apply,
      plan,
      sent: false,
      blockCleared: null,
      observation: memo?.observation ?? null,
    };
  await deps.send(plan, signal);
  let latest = memo;
  let cleared = false;
  for (let attempt = 0; !cleared && attempt < READ_BACK_ATTEMPTS; attempt++) {
    if (attempt > 0) await deps.sleep(READ_BACK_INTERVAL_MS);
    latest = await deps.read(signal);
    // A missing memo or a fresh block under a new request ID is not a clear.
    cleared = latest !== null && latest.blocked[kind] === undefined;
  }
  return {
    kind,
    dryRun: false,
    plan,
    sent: true,
    blockCleared: cleared,
    observation: latest?.observation ?? null,
  };
}

export function formatMaintenanceRetry(report: RetryReport): string {
  const { plan } = report;
  if (plan.action === "refuse") return `No retry for ${plan.kind}: ${plan.why}`;
  const target = `${plan.kind} request ${plan.requestId} (blocked: ${plan.blockedReason})`;
  if (report.dryRun)
    return `Would send ${MAINTENANCE_RETRY_SIGNAL} for ${target}. Dry run; pass --apply to send.`;
  return [
    `Sent ${MAINTENANCE_RETRY_SIGNAL} for ${target}.`,
    report.blockCleared === true
      ? "Read back: the coordinator cleared the block."
      : "Read back: the block is still present; the coordinator has not processed the signal yet. Re-run without --apply to inspect.",
    ...(report.observation === null
      ? []
      : [`Coordinator: ${report.observation}`]),
  ].join("\n");
}
