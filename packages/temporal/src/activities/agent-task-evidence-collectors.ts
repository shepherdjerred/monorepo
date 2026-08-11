import { z } from "zod/v4";
import {
  createAgentTaskSecretTokenState,
  AgentTaskSecretRedactionController,
  envForEvidenceCollector,
  refreshAgentTaskSecretTokenStateInBackground,
} from "#activities/agent-task-env.ts";
import {
  activityCancellationSignalOrUndefined,
  jsonLog,
  safeHeartbeat,
} from "#activities/agent-task-runtime.ts";
import { runTrackedAgentSubprocess } from "#shared/agent-subprocess.ts";
import { providerSubprocessCommand } from "#shared/agent-subprocess-identity.ts";
import { agentTaskChecksV2, type AgentTaskInput } from "#shared/agent-task.ts";
import {
  agentTaskCollectorReceiptId,
  type AgentTaskEvidenceCollectorV2,
} from "#shared/agent-task-evidence-contract.ts";
import type { ReportEvidenceReceiptV1 } from "#shared/report.ts";
import { redactSecrets } from "#shared/redact.ts";

const COLLECTOR_TIMEOUT_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MOUNTED_SECRET_REFRESH_INTERVAL_MS = 10_000;

const StructuredJsonSchema = z.union([
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
]);

const PrometheusSampleSchema = z.tuple([
  z.union([z.number(), z.string()]),
  z.string(),
]);

const PrometheusQueryResponseSchema = z.object({
  status: z.literal("success"),
  data: z.discriminatedUnion("resultType", [
    z.object({
      resultType: z.literal("vector"),
      result: z.array(z.looseObject({ value: PrometheusSampleSchema })),
    }),
    z.object({
      resultType: z.literal("matrix"),
      result: z.array(
        z.looseObject({ values: z.array(PrometheusSampleSchema) }),
      ),
    }),
    z.object({
      resultType: z.enum(["scalar", "string"]),
      result: PrometheusSampleSchema,
    }),
  ]),
});

type CollectorDependencies = {
  fetch: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  environment: Readonly<Record<string, string | undefined>>;
};

const DEFAULT_DEPENDENCIES: CollectorDependencies = {
  fetch,
  environment: Bun.env,
};

function noOp(): void {
  return;
}

function bounded(value: string, maximum = 2000): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.length <= maximum ? trimmed : `${trimmed.slice(0, maximum)}…`;
}

function sha256(value: string): string | undefined {
  if (value.length === 0) return undefined;
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest("hex");
}

function receiptContent(
  output: string,
  failure: string | undefined,
): Pick<ReportEvidenceReceiptV1, "excerpt" | "contentSha256"> {
  const content = failure === undefined ? output : `${failure}\n${output}`;
  const excerpt = bounded(content);
  const contentSha256 = sha256(output);
  return {
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(contentSha256 === undefined ? {} : { contentSha256 }),
  };
}

function collectorCommandDisplay(argv: readonly string[]): string {
  return JSON.stringify(argv);
}

function commandValidationFailure(
  collector: Extract<AgentTaskEvidenceCollectorV2, { kind: "command" }>,
  stdout: string,
): string | undefined {
  if (collector.output === "allow-empty") return undefined;
  if (stdout.trim().length === 0) {
    return "Collector produced no stdout.";
  }
  if (collector.output === "non-empty") return undefined;
  try {
    StructuredJsonSchema.parse(JSON.parse(stdout));
    return undefined;
  } catch (error: unknown) {
    return `Collector stdout was not a JSON object or array: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function commandSemanticStatus(
  collector: Extract<AgentTaskEvidenceCollectorV2, { kind: "command" }>,
  exitCode: number,
  stdout: string,
  validationFailure: string | undefined,
): ReportEvidenceReceiptV1["semanticStatus"] {
  if (validationFailure !== undefined || collector.expectation === undefined) {
    return undefined;
  }
  if (collector.expectation.kind === "exit-code") {
    return collector.expectation.passedExitCodes.includes(exitCode)
      ? "passed"
      : "failed";
  }
  const parsed = StructuredJsonSchema.parse(JSON.parse(stdout));
  const passed = collector.expectation.assertions.every((assertion) => {
    const values = resolveJsonPath(parsed, assertion.path);
    if (values.length === 0) return false;
    const matches = values.map((value) =>
      compareJsonValue(value, assertion.operator, assertion.expected),
    );
    return assertion.quantifier === "all"
      ? matches.every(Boolean)
      : matches.some(Boolean);
  });
  return passed ? "passed" : "failed";
}

function resolveJsonPath(value: unknown, path: readonly string[]): unknown[] {
  return path.reduce<unknown[]>(
    (current, segment) => {
      if (segment === "*") {
        return current.flatMap((item) => {
          const array = z.array(z.unknown()).safeParse(item);
          if (array.success) return array.data;
          const record = z.record(z.string(), z.unknown()).safeParse(item);
          return record.success ? Object.values(record.data) : [];
        });
      }
      return current.flatMap((item) => {
        const record = z.record(z.string(), z.unknown()).safeParse(item);
        if (!record.success || !(segment in record.data)) return [];
        return [record.data[segment]];
      });
    },
    [value],
  );
}

function compareJsonValue(
  actual: unknown,
  operator: "eq" | "gt" | "gte" | "lt" | "lte" | "in",
  expected: string | number | boolean | (string | number | boolean)[],
): boolean {
  if (operator === "eq") return Object.is(actual, expected);
  if (operator === "in") {
    return (
      Array.isArray(expected) &&
      expected.some((item) => Object.is(actual, item))
    );
  }
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (operator === "gt") return actual > expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lt") return actual < expected;
  return actual <= expected;
}

function prometheusValues(
  data: z.infer<typeof PrometheusQueryResponseSchema>["data"],
): number[] | undefined {
  const samples =
    data.resultType === "vector"
      ? data.result.map((item) => item.value)
      : data.resultType === "matrix"
        ? data.result.flatMap((item) => item.values)
        : [data.result];
  const values = samples.map((sample) => Number(sample[1]));
  return values.length > 0 && values.every((value) => Number.isFinite(value))
    ? values
    : undefined;
}

function comparePrometheusValue(
  value: number,
  operator: NonNullable<
    Extract<AgentTaskEvidenceCollectorV2, { kind: "prometheus" }>["expectation"]
  >["operator"],
  threshold: number,
): boolean {
  if (operator === "eq") return value === threshold;
  if (operator === "gt") return value > threshold;
  if (operator === "gte") return value >= threshold;
  if (operator === "lt") return value < threshold;
  return value <= threshold;
}

function prometheusSemanticStatus(
  collector: Extract<AgentTaskEvidenceCollectorV2, { kind: "prometheus" }>,
  data: z.infer<typeof PrometheusQueryResponseSchema>["data"],
): ReportEvidenceReceiptV1["semanticStatus"] {
  const expectation = collector.expectation;
  if (expectation === undefined) return undefined;
  const values = prometheusValues(data);
  if (values === undefined) return "failed";
  const matches = values.map((value) =>
    comparePrometheusValue(value, expectation.operator, expectation.threshold),
  );
  return expectation.quantifier === "all"
    ? matches.every(Boolean)
      ? "passed"
      : "failed"
    : matches.some(Boolean)
      ? "passed"
      : "failed";
}

async function collectCommandEvidence(
  checkId: string,
  collector: Extract<AgentTaskEvidenceCollectorV2, { kind: "command" }>,
  workdir: string,
  dependencies: CollectorDependencies,
): Promise<ReportEvidenceReceiptV1> {
  const secretTokenState = await createAgentTaskSecretTokenState(
    undefined,
    dependencies.environment,
  );
  const redactionFailureController = new AgentTaskSecretRedactionController(
    () => {
      jsonLog("error", "Unable to refresh declared collector secrets", {
        phase: "declared-evidence",
        checkId,
        collectorId: collector.id,
      });
    },
  );
  const timeoutSignal = AbortSignal.timeout(COLLECTOR_TIMEOUT_MS);
  const activityCancellationSignal = activityCancellationSignalOrUndefined();
  const cancellationSignal =
    activityCancellationSignal === undefined
      ? AbortSignal.any([
          timeoutSignal,
          redactionFailureController.abortController.signal,
        ])
      : AbortSignal.any([
          activityCancellationSignal,
          timeoutSignal,
          redactionFailureController.abortController.signal,
        ]);
  const mountedSecretRefreshTimer = setInterval(() => {
    void refreshAgentTaskSecretTokenStateInBackground(
      secretTokenState,
      (error) => {
        redactionFailureController.record(error);
      },
    );
  }, MOUNTED_SECRET_REFRESH_INTERVAL_MS);

  try {
    const result = await runTrackedAgentSubprocess(
      {
        command: providerSubprocessCommand(collector.argv),
        cwd: workdir,
        env: envForEvidenceCollector(workdir, dependencies.environment),
        redactTokens: secretTokenState.tokens,
        beforeOutput: () =>
          redactionFailureController.refreshBeforeOutput(secretTokenState),
        startToCloseTimeoutMs: undefined,
        cancellationSignal,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
        onHeartbeat: (beat) => {
          safeHeartbeat({
            phase: "declared-evidence",
            checkId,
            collectorId: collector.id,
            ...beat,
          });
        },
        onSoftKill: noOp,
        onStdoutLine: noOp,
        onStderrLine: noOp,
        onCancellation: noOp,
      },
      redactSecrets,
    );
    await secretTokenState.refresh();
    if (redactionFailureController.failure !== undefined) {
      throw redactionFailureController.failure;
    }
    if (activityCancellationSignal?.aborted === true) {
      throw new Error("Declared evidence collection was cancelled");
    }

    const stdout = redactSecrets(result.stdout, secretTokenState.tokens);
    const command = redactSecrets(
      collectorCommandDisplay(collector.argv),
      secretTokenState.tokens,
    );
    const successExitCodes = collector.successExitCodes ?? [0];
    const processFailure =
      successExitCodes.includes(result.exitCode) && result.signal === "natural"
        ? undefined
        : timeoutSignal.aborted
          ? "Collector timed out after 60 seconds."
          : `Collector exited with code ${String(result.exitCode)} (${result.signal}).`;
    const validationFailure =
      processFailure ?? commandValidationFailure(collector, result.stdout);
    const semanticStatus = commandSemanticStatus(
      collector,
      result.exitCode,
      result.stdout,
      validationFailure,
    );
    return {
      id: agentTaskCollectorReceiptId(checkId, collector.id),
      source: `declared-command:${collector.id}`,
      origin: "declared-collector",
      observedAt: new Date().toISOString(),
      status: validationFailure === undefined ? "success" : "failure",
      ...(semanticStatus === undefined ? {} : { semanticStatus }),
      command,
      exitCode: result.exitCode,
      ...receiptContent(stdout, validationFailure),
    };
  } finally {
    clearInterval(mountedSecretRefreshTimer);
  }
}

async function collectPrometheusEvidence(
  checkId: string,
  collector: Extract<AgentTaskEvidenceCollectorV2, { kind: "prometheus" }>,
  dependencies: CollectorDependencies,
): Promise<ReportEvidenceReceiptV1> {
  const id = agentTaskCollectorReceiptId(checkId, collector.id);
  const observedAt = new Date().toISOString();
  const baseUrl = dependencies.environment["PROMETHEUS_URL"];
  if (baseUrl === undefined || baseUrl.length === 0) {
    return {
      id,
      source: `prometheus:${collector.id}`,
      origin: "declared-collector",
      observedAt,
      status: "failure",
      excerpt: "PROMETHEUS_URL is not configured for the collector.",
    };
  }

  const end = new Date();
  const url = new URL(
    collector.windowSeconds === undefined
      ? "/api/v1/query"
      : "/api/v1/query_range",
    baseUrl,
  );
  url.searchParams.set("query", collector.query);
  if (collector.windowSeconds !== undefined) {
    url.searchParams.set(
      "start",
      new Date(end.getTime() - collector.windowSeconds * 1000).toISOString(),
    );
    url.searchParams.set("end", end.toISOString());
    url.searchParams.set("step", String(collector.stepSeconds ?? 60));
  }
  const timeoutSignal = AbortSignal.timeout(COLLECTOR_TIMEOUT_MS);
  const activityCancellationSignal = activityCancellationSignalOrUndefined();
  const signal =
    activityCancellationSignal === undefined
      ? timeoutSignal
      : AbortSignal.any([activityCancellationSignal, timeoutSignal]);
  const secretTokenState = await createAgentTaskSecretTokenState(
    undefined,
    dependencies.environment,
  );
  try {
    const response = await dependencies.fetch(url, { signal });
    const rawBody = await response.text();
    const parsed = PrometheusQueryResponseSchema.safeParse(JSON.parse(rawBody));
    await secretTokenState.refresh();
    const body = redactSecrets(rawBody, secretTokenState.tokens);
    const failure = response.ok
      ? parsed.success
        ? undefined
        : "Prometheus response did not satisfy the successful query schema."
      : `Prometheus returned HTTP ${String(response.status)}.`;
    const semanticStatus =
      failure === undefined && parsed.success
        ? prometheusSemanticStatus(collector, parsed.data.data)
        : undefined;
    return {
      id,
      source: `prometheus:${collector.id}`,
      origin: "declared-collector",
      observedAt: new Date().toISOString(),
      status: failure === undefined ? "success" : "failure",
      ...(semanticStatus === undefined ? {} : { semanticStatus }),
      url: url.toString(),
      ...receiptContent(body, failure),
    };
  } catch (error: unknown) {
    const failure = timeoutSignal.aborted
      ? "Prometheus collector timed out after 60 seconds."
      : `Prometheus collector failed: ${error instanceof Error ? error.message : String(error)}`;
    return {
      id,
      source: `prometheus:${collector.id}`,
      origin: "declared-collector",
      observedAt: new Date().toISOString(),
      status: "failure",
      url: url.toString(),
      excerpt: failure.slice(0, 2000),
    };
  }
}

export async function collectDeclaredAgentTaskEvidence(
  input: AgentTaskInput,
  workdir: string,
  dependencies: CollectorDependencies = DEFAULT_DEPENDENCIES,
): Promise<ReportEvidenceReceiptV1[]> {
  const collections = agentTaskChecksV2(input).flatMap((check) =>
    (check.evidenceCollectors ?? []).map((collector) =>
      collector.kind === "command"
        ? collectCommandEvidence(check.id, collector, workdir, dependencies)
        : collectPrometheusEvidence(check.id, collector, dependencies),
    ),
  );
  return await Promise.all(collections);
}

export function mergeAgentTaskEvidence(
  providerEvidence: readonly ReportEvidenceReceiptV1[],
  declaredEvidence: readonly ReportEvidenceReceiptV1[],
): ReportEvidenceReceiptV1[] {
  const declaredIds = new Set(declaredEvidence.map((receipt) => receipt.id));
  return [
    ...providerEvidence.filter((receipt) => !declaredIds.has(receipt.id)),
    ...declaredEvidence,
  ];
}
