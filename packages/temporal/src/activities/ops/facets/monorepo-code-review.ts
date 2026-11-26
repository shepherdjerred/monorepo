import { Context } from "@temporalio/activity";
import { WorkflowNotFoundError, type Client } from "@temporalio/client";
import {
  PROVIDERS,
  ProviderIdSchema,
  type ProviderId,
} from "@shepherdjerred/code-review";
import type { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";
import type {
  CodeReviewProviderPoolStatus,
  MonorepoAudit,
  MonorepoCodeReview,
  MonorepoCodeReviewProvider,
} from "@shepherdjerred/ops-model/facets.ts";
import { z } from "zod";
import { createTemporalReadClient } from "#client";
import {
  codeReviewConfig,
  type CodeReviewRuntimeConfig,
} from "#config/code-review.ts";
import { withScheduleReads } from "#activities/ops/temporal-schedule-reads.ts";
import {
  CODE_REVIEW_COORDINATOR_WORKFLOW_ID,
  DEFAULT_CODE_REVIEW_SETTINGS,
} from "#shared/ci/code-review.ts";

const PAID_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set(["codex"]);

const DISPLAY_PROVIDER_ORDER = new Set<ProviderId>([
  "coderabbit",
  "codex",
  "cubic",
  "codeant",
  "qodo",
  "greptile",
]);

const CoordinatorMemoSchema = z.object({
  processedCount: z.number().int().nonnegative().default(0),
  weighted: z
    .object({
      currentWeights: z.record(z.string(), z.number()).default({}),
      cooldownUntilMs: z.record(z.string(), z.number()).default({}),
    })
    .default({ currentWeights: {}, cooldownUntilMs: {} }),
});

export type CoordinatorObservation = {
  observed: boolean;
  running: boolean;
  processedCount: number;
  currentWeights: Readonly<Record<string, number>>;
  cooldownUntilMs: Readonly<Record<string, number>>;
};

const EMPTY_COORDINATOR: CoordinatorObservation = {
  observed: true,
  running: false,
  processedCount: 0,
  currentWeights: {},
  cooldownUntilMs: {},
};

const UNAVAILABLE_COORDINATOR: CoordinatorObservation = {
  observed: false,
  running: false,
  processedCount: 0,
  currentWeights: {},
  cooldownUntilMs: {},
};

function activityCancellationSignal(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

export async function describeCodeReviewCoordinatorMemo(
  describeWorkflow: () => Promise<{
    status?: { name?: string };
    memo?: Record<string, unknown>;
  }>,
): Promise<CoordinatorObservation> {
  try {
    const description = await describeWorkflow();
    const raw = description.memo?.["codeReviewCoordinator"];
    const running =
      description.status?.name === undefined ||
      description.status.name === "RUNNING";
    if (raw === undefined) {
      return { ...EMPTY_COORDINATOR, running };
    }
    const parsed = CoordinatorMemoSchema.safeParse(raw);
    if (!parsed.success) {
      return { ...UNAVAILABLE_COORDINATOR, running };
    }
    return {
      observed: true,
      running,
      processedCount: parsed.data.processedCount,
      currentWeights: parsed.data.weighted.currentWeights,
      cooldownUntilMs: parsed.data.weighted.cooldownUntilMs,
    };
  } catch (error: unknown) {
    if (error instanceof WorkflowNotFoundError) {
      return EMPTY_COORDINATOR;
    }
    throw error;
  }
}

export async function readProdCodeReviewCoordinator(
  getClient: () => Promise<Client> = () => createTemporalReadClient("prod"),
): Promise<CoordinatorObservation> {
  if ((Bun.env["TEMPORAL_ADDRESS"] ?? "").trim() === "") {
    return UNAVAILABLE_COORDINATOR;
  }
  const signal = activityCancellationSignal();
  try {
    return await withScheduleReads(
      async (scope) => {
        const client = await scope.read(getClient);
        return await scope.read(() =>
          client.connection.withAbortSignal(scope.signal, () =>
            client.connection.withDeadline(scope.deadline, () =>
              describeCodeReviewCoordinatorMemo(() =>
                client.workflow
                  .getHandle(CODE_REVIEW_COORDINATOR_WORKFLOW_ID)
                  .describe(),
              ),
            ),
          ),
        );
      },
      signal === undefined ? {} : { signal },
    );
  } catch {
    return UNAVAILABLE_COORDINATOR;
  }
}

async function loadRuntimeConfig(
  loader?: () => Promise<CodeReviewRuntimeConfig>,
): Promise<CodeReviewRuntimeConfig> {
  if (loader !== undefined) {
    return await loader();
  }
  return (Bun.env["FEATURE_FLAGS_MODE"] ?? "").trim() === ""
    ? { enabled: true, settings: DEFAULT_CODE_REVIEW_SETTINGS }
    : await codeReviewConfig();
}

type PromSample = Awaited<ReturnType<PrometheusClient["query"]>>[number];

function roundCount(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function finiteNullable(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.round(value * 10) / 10
    : null;
}

function unwrapSamples(
  settled: PromiseSettledResult<PromSample[]>,
): PromSample[] {
  return settled.status === "fulfilled" ? settled.value : [];
}

function indexBySingleLabel(
  samples: readonly PromSample[],
  labelKey: string,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const sample of samples) {
    const key = sample.metric[labelKey];
    if (key !== undefined) {
      out.set(key, roundCount(sample.value));
    }
  }
  return out;
}

function indexProviderOutcomes(
  samples: readonly PromSample[],
): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const sample of samples) {
    const provider = sample.metric["provider"];
    const outcome = sample.metric["outcome"];
    if (provider !== undefined && outcome !== undefined) {
      let inner = out.get(provider);
      if (inner === undefined) {
        inner = new Map();
        out.set(provider, inner);
      }
      inner.set(outcome, roundCount(sample.value));
    }
  }
  return out;
}

type PromMetricsSnapshot = {
  assignmentsByProvider: Map<string, number>;
  outcomesByProvider: Map<string, Map<string, number>>;
  cooldownsByProvider: Map<string, number>;
  gateOutcomesByReason: Map<string, number>;
  medianDurationSeconds: number | null;
  p95DurationSeconds: number | null;
};

async function queryCodeReviewPrometheus(
  prometheus: PrometheusClient | undefined,
): Promise<PromMetricsSnapshot> {
  if (prometheus === undefined) {
    return {
      assignmentsByProvider: new Map(),
      outcomesByProvider: new Map(),
      cooldownsByProvider: new Map(),
      gateOutcomesByReason: new Map(),
      medianDurationSeconds: null,
      p95DurationSeconds: null,
    };
  }

  const [
    assignmentsSettled,
    providerOutcomesSettled,
    cooldownsSettled,
    gateOutcomesSettled,
    p50Settled,
    p95Settled,
  ] = await Promise.allSettled([
    prometheus.query(
      "sum by (provider) (increase(pr_code_review_assignments_total[7d]))",
    ),
    prometheus.query(
      "sum by (provider, outcome) (increase(pr_code_review_provider_outcomes_total[7d]))",
    ),
    prometheus.query(
      "sum by (provider) (increase(pr_code_review_provider_cooldowns_total[7d]))",
    ),
    prometheus.query(
      "sum by (reason) (increase(pr_code_review_outcomes_total[7d]))",
    ),
    prometheus.query(
      'histogram_quantile(0.5, sum by (le) (increase(pr_code_review_duration_seconds_bucket{result="success"}[7d])))',
    ),
    prometheus.query(
      'histogram_quantile(0.95, sum by (le) (increase(pr_code_review_duration_seconds_bucket{result="success"}[7d])))',
    ),
  ]);

  return {
    assignmentsByProvider: indexBySingleLabel(
      unwrapSamples(assignmentsSettled),
      "provider",
    ),
    outcomesByProvider: indexProviderOutcomes(
      unwrapSamples(providerOutcomesSettled),
    ),
    cooldownsByProvider: indexBySingleLabel(
      unwrapSamples(cooldownsSettled),
      "provider",
    ),
    gateOutcomesByReason: indexBySingleLabel(
      unwrapSamples(gateOutcomesSettled),
      "reason",
    ),
    medianDurationSeconds: finiteNullable(unwrapSamples(p50Settled)[0]?.value),
    p95DurationSeconds: finiteNullable(unwrapSamples(p95Settled)[0]?.value),
  };
}

function resolvePoolStatus(args: {
  enabled: boolean;
  configuredWeight: number;
  coordinatorObserved: boolean;
  inCooldown: boolean;
}): CodeReviewProviderPoolStatus {
  if (!args.enabled) {
    return "disabled";
  }
  if (args.configuredWeight <= 0) {
    return "standby";
  }
  if (!args.coordinatorObserved) {
    return "unknown";
  }
  return args.inCooldown ? "cooldown" : "ready";
}

function buildProviderRow(args: {
  id: ProviderId;
  nowMs: number;
  totalWeight: number;
  runtime: CodeReviewRuntimeConfig;
  coordinator: CoordinatorObservation;
  prom: PromMetricsSnapshot;
}): MonorepoCodeReviewProvider {
  const { id, nowMs, totalWeight, runtime, coordinator, prom } = args;
  const configuredWeight = runtime.settings.weights[id] ?? 0;
  const rawCooldownUntilMs = coordinator.cooldownUntilMs[id];
  const inCooldown =
    coordinator.observed &&
    rawCooldownUntilMs !== undefined &&
    rawCooldownUntilMs > nowMs;
  const status = resolvePoolStatus({
    enabled: runtime.enabled,
    configuredWeight,
    coordinatorObserved: coordinator.observed,
    inCooldown,
  });
  const byOutcome = prom.outcomesByProvider.get(id);

  return {
    id,
    displayName: PROVIDERS[id].displayName,
    tier: PAID_PROVIDER_IDS.has(id) ? "paid" : "free",
    configuredWeight,
    targetShareRatio:
      configuredWeight > 0 && totalWeight > 0
        ? Math.round((configuredWeight / totalWeight) * 1000) / 1000
        : null,
    currentSmoothWeight: coordinator.currentWeights[id] ?? 0,
    status,
    cooldownUntil: inCooldown
      ? new Date(rawCooldownUntilMs).toISOString()
      : null,
    assignments7d: prom.assignmentsByProvider.get(id) ?? 0,
    completed7d: byOutcome?.get("completed") ?? 0,
    usageLimited7d: byOutcome?.get("usage-limited") ?? 0,
    timedOut7d: byOutcome?.get("timed-out") ?? 0,
    skipped7d: byOutcome?.get("skipped") ?? 0,
    cooldowns7d: prom.cooldownsByProvider.get(id) ?? 0,
  };
}

export type CollectMonorepoCodeReviewOptions = {
  now: Date;
  prometheus?: PrometheusClient | undefined;
  loadRuntimeConfig?: (() => Promise<CodeReviewRuntimeConfig>) | undefined;
  readCoordinator?: (() => Promise<CoordinatorObservation>) | undefined;
};

export async function collectMonorepoCodeReview(
  options: CollectMonorepoCodeReviewOptions,
): Promise<MonorepoCodeReview> {
  const nowMs = options.now.getTime();
  const [runtime, coordinator, prom] = await Promise.all([
    loadRuntimeConfig(options.loadRuntimeConfig),
    (options.readCoordinator ?? readProdCodeReviewCoordinator)(),
    queryCodeReviewPrometheus(options.prometheus),
  ]);

  const allIds: ProviderId[] = [
    ...DISPLAY_PROVIDER_ORDER,
    ...ProviderIdSchema.options.filter((id) => !DISPLAY_PROVIDER_ORDER.has(id)),
  ];

  const totalWeight = allIds.reduce(
    (sum, id) => sum + (runtime.settings.weights[id] ?? 0),
    0,
  );

  const providers = allIds.map((id) =>
    buildProviderRow({
      id,
      nowMs,
      totalWeight,
      runtime,
      coordinator,
      prom,
    }),
  );

  const readyProvidersCount = providers.filter(
    (p) => p.status === "ready",
  ).length;
  const coolingDownProvidersCount = providers.filter(
    (p) => p.status === "cooldown",
  ).length;
  const activeProvidersCount = providers.filter(
    (p) => runtime.enabled && p.configuredWeight > 0,
  ).length;
  const reason = (key: string): number =>
    prom.gateOutcomesByReason.get(key) ?? 0;

  return {
    enabled: runtime.enabled,
    coordinatorObserved: coordinator.observed,
    coordinatorRunning: coordinator.running,
    coordinatorProcessedCount: coordinator.processedCount,
    activeProvidersCount,
    readyProvidersCount,
    coolingDownProvidersCount,
    outcomes7d: {
      clean: reason("clean"),
      priorRound: reason("prior-round"),
      threadsResolved: reason("threads-resolved"),
      quotaExempt: reason("quota-exempt"),
      providerTimeout: reason("provider-timeout"),
      allSkipped: reason("all-skipped"),
      blockingFindings: reason("blocking-findings"),
      p0Veto: reason("p0-veto"),
      reviewWithdrawn: reason("review-withdrawn"),
    },
    medianDurationSeconds7d: prom.medianDurationSeconds,
    p95DurationSeconds7d: prom.p95DurationSeconds,
    providers,
  };
}

export function buildCodeReviewPoolAudit(
  codeReview: MonorepoCodeReview,
  nowIso: string,
): MonorepoAudit {
  if (!codeReview.enabled) {
    return {
      id: "code-review-pool",
      label: "PR code-review provider pool",
      status: "warning",
      lastRunAt: nowIso,
      detail: "Temporal PR code-review gate is disabled in Flags",
    };
  }
  if (codeReview.activeProvidersCount === 0) {
    return {
      id: "code-review-pool",
      label: "PR code-review provider pool",
      status: "warning",
      lastRunAt: nowIso,
      detail: "No weighted code-review providers configured",
    };
  }
  if (!codeReview.coordinatorObserved) {
    return {
      id: "code-review-pool",
      label: "PR code-review provider pool",
      status: "unknown",
      lastRunAt: nowIso,
      detail: "Coordinator state unavailable; pool readiness not observed",
    };
  }
  if (codeReview.readyProvidersCount === 0) {
    return {
      id: "code-review-pool",
      label: "PR code-review provider pool",
      status: "warning",
      lastRunAt: nowIso,
      detail: `All ${String(codeReview.activeProvidersCount)} active provider(s) in cooldown`,
    };
  }
  const o = codeReview.outcomes7d;
  const totalOutcomes =
    o.clean +
    o.priorRound +
    o.threadsResolved +
    o.quotaExempt +
    o.providerTimeout +
    o.allSkipped +
    o.blockingFindings +
    o.p0Veto +
    o.reviewWithdrawn;
  const fallbackCount = o.quotaExempt + o.providerTimeout;
  if (totalOutcomes >= 10 && fallbackCount / totalOutcomes > 0.5) {
    const pct = Math.round((fallbackCount / totalOutcomes) * 100);
    return {
      id: "code-review-pool",
      label: "PR code-review provider pool",
      status: "warning",
      lastRunAt: nowIso,
      detail: `${String(pct)}% advisory fallback (timeout or quota-exempt) over 7d`,
    };
  }
  return {
    id: "code-review-pool",
    label: "PR code-review provider pool",
    status: "ok",
    lastRunAt: nowIso,
    detail: `${String(codeReview.readyProvidersCount)}/${String(codeReview.activeProvidersCount)} active providers ready`,
  };
}
