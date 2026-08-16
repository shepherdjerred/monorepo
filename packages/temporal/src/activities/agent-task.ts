import { ApplicationFailure } from "@temporalio/activity";
import {
  agentSubprocessIdleSeconds,
  agentTaskRunsTotal,
  agentTaskSdkDurationSeconds,
  agentTaskSdkRunsTotal,
} from "#observability/metrics.ts";
import { withSpan } from "#observability/tracing.ts";
import { buildAgentTaskSdkConfig } from "#activities/agent-task-sdk-config.ts";
import {
  AgentTaskSdkExecutionError,
  runAgentTaskSdk,
  type AgentTaskSdkResult,
  type AgentTaskSdkRunInput,
} from "#activities/agent-task-sdk.ts";
import {
  collectDeclaredAgentTaskEvidence,
  mergeAgentTaskEvidence,
} from "#activities/agent-task-evidence-collectors.ts";
import {
  createAgentTaskSecretTokenState,
  AgentTaskSecretRedactionController,
  envForProvider,
  refreshAgentTaskSecretTokenStateInBackground,
} from "#activities/agent-task-env.ts";
import {
  SINGLE_AGENT_TASK_PROMPT_PHASE,
  type AgentTaskPromptPhase,
} from "#shared/agent-task-prompt.ts";
import {
  AgentTaskInputSchema,
  AgentTaskResultPayloadSchema,
  AgentTaskResultPayloadV2Schema,
  type AgentTaskInput,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
  type AgentTaskResultPayloadV2,
} from "#shared/agent-task.ts";
import { extractAgentTaskEvidenceReceipts } from "#shared/agent-task-evidence.ts";
import type { ReportEvidenceReceiptV1 } from "#shared/report.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  activityCancellationSignalOrUndefined,
  captureWithContext,
  currentWorkflowType,
  jsonLog,
  safeHeartbeat,
  startToCloseTimeoutMsOrUndefined,
  throwIfAgentTaskSecretRedactionFailed,
} from "#activities/agent-task-runtime.ts";
import { decodeAgentTaskPayload } from "#activities/agent-task-result.ts";
import { prepareAgentTaskWorkdir } from "#activities/agent-task-workdir.ts";
import {
  cleanup,
  pauseSchedule,
  scheduleFollowUp,
  sendEmail,
  sendFailureReport,
} from "./agent-task-side-activities.ts";

const HEARTBEAT_INTERVAL_MS = 10_000;
const MOUNTED_SECRET_REFRESH_INTERVAL_MS = 10_000;
const TEMPORAL_TIMEOUT_HEADROOM_MS = 15_000;

export type RunAgentTaskInput = {
  input: AgentTaskInput;
  workdir: string;
  phase?: AgentTaskPromptPhase;
  recordSuccess?: boolean;
};

type RunAgentTaskResultBase = {
  provider: AgentTaskProvider;
  model: string;
  durationMs: number;
  startedAt: string;
  evidence: ReportEvidenceReceiptV1[];
};
export type RunAgentTaskResultV2 = RunAgentTaskResultBase & {
  contractVersion: 2;
  payload: AgentTaskResultPayloadV2;
};
export type RunAgentTaskResult = RunAgentTaskResultBase &
  (
    | ({
        contractVersion: 1;
        payload: AgentTaskResultPayload;
      } & AgentTaskResultPayload)
    | RunAgentTaskResultV2
  );
export type FinalizeAgentTaskInput = RunAgentTaskInput & {
  investigation: RunAgentTaskResultV2;
};

type AgentTaskSdkRunner = (
  input: AgentTaskSdkRunInput,
) => Promise<AgentTaskSdkResult>;

function timeoutAbortController(startToCloseTimeoutMs: number | undefined): {
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
} {
  const controller = new AbortController();
  if (startToCloseTimeoutMs === undefined) {
    return { controller, timer: undefined };
  }
  const timeoutMs = Math.max(
    1,
    startToCloseTimeoutMs - TEMPORAL_TIMEOUT_HEADROOM_MS,
  );
  const timer = setTimeout(() => {
    controller.abort(
      new Error("Agent SDK run stopped before Temporal start-to-close timeout"),
    );
  }, timeoutMs);
  return { controller, timer };
}

function asNonRetryableSdkFailure(error: AgentTaskSdkExecutionError): Error {
  if (
    !error.authOrQuotaFailure &&
    !error.generationStarted &&
    !error.possiblyAppliedEffects
  ) {
    return error;
  }
  return ApplicationFailure.create({
    message: error.message,
    cause: error,
    nonRetryable: true,
    type: error.authOrQuotaFailure
      ? "AgentSdkAuthOrQuotaFailure"
      : "AgentSdkPossiblyAppliedFailure",
  });
}

async function runAgent(
  input: RunAgentTaskInput,
  sdkRunner: AgentTaskSdkRunner,
): Promise<RunAgentTaskResult> {
  const parsed = AgentTaskInputSchema.parse(input.input);
  const provider = parsed.provider;
  const phase = input.phase ?? SINGLE_AGENT_TASK_PROMPT_PHASE;
  const config = buildAgentTaskSdkConfig(parsed, input.workdir, phase);
  const workflowType = currentWorkflowType();
  return withSpan(
    "agent-task.run-agent",
    {
      "agent.provider": provider,
      "agent.title": parsed.title,
      "agent.model": config.model,
      "agent.runtime": provider === "claude" ? "claude_agent_sdk" : "codex_sdk",
      "agent.workdir": input.workdir,
      "agent.timeout_minutes": parsed.agentTimeoutMinutes ?? 0,
      "agent.max_turns": config.maxTurns,
      "agent.phase": config.phase,
      "agent.contract_version": config.contractVersion,
    },
    async (span) => {
      jsonLog("info", "Invoking native agent SDK task", {
        phase: "start",
        provider,
        title: parsed.title,
        model: config.model,
        workdir: input.workdir,
        agentTimeoutMinutes: parsed.agentTimeoutMinutes,
        maxTurns: config.maxTurns,
        agentPhase: config.phase,
        contractVersion: config.contractVersion,
      });
      const startedAtMs = Date.now();
      const secretTokenState = await createAgentTaskSecretTokenState(undefined);
      const redactionFailureController = new AgentTaskSecretRedactionController(
        () => {
          jsonLog("error", "Unable to refresh mounted agent-task secrets", {
            phase: "secret-redaction",
          });
        },
      );
      const timeout = timeoutAbortController(
        startToCloseTimeoutMsOrUndefined(),
      );
      const activityCancellationSignal =
        activityCancellationSignalOrUndefined();
      const signals = [
        redactionFailureController.abortController.signal,
        timeout.controller.signal,
        ...(activityCancellationSignal === undefined
          ? []
          : [activityCancellationSignal]),
      ];
      const cancellationSignal = AbortSignal.any(signals);
      let lastEventAtMs = Date.now();
      let maxIdleMs = 0;
      let eventCount = 0;

      const mountedSecretRefreshTimer = setInterval(() => {
        void refreshAgentTaskSecretTokenStateInBackground(
          secretTokenState,
          (error) => {
            redactionFailureController.record(error);
          },
        );
      }, MOUNTED_SECRET_REFRESH_INTERVAL_MS);
      const heartbeatTimer = setInterval(() => {
        const now = Date.now();
        const idleMs = now - lastEventAtMs;
        maxIdleMs = Math.max(maxIdleMs, idleMs);
        const heartbeat = { eventCount, idleMs };
        safeHeartbeat({ phase: "agent-sdk", provider, ...heartbeat });
        jsonLog("info", "agent SDK heartbeat", {
          phase: "agent-sdk",
          provider,
          ...heartbeat,
        });
        span.addEvent("agent.heartbeat", heartbeat);
      }, HEARTBEAT_INTERVAL_MS);

      let result: AgentTaskSdkResult;
      try {
        result = await sdkRunner({
          config,
          env: envForProvider(provider, input.workdir),
          signal: cancellationSignal,
          redactTokens: secretTokenState.tokens,
          beforeEvent: async () =>
            redactionFailureController.failure === undefined &&
            redactionFailureController.refreshBeforeOutput(secretTokenState),
          onEvent: (event) => {
            eventCount += 1;
            lastEventAtMs = Date.now();
            maxIdleMs = Math.max(maxIdleMs, event.idleMs);
            jsonLog("info", "agent SDK event", {
              phase: "agent-event",
              provider,
              type: event.type,
              elapsedMs: event.elapsedMs,
              idleMs: event.idleMs,
            });
            span.addEvent("agent.event", {
              type: event.type,
              elapsedMs: event.elapsedMs,
              idleMs: event.idleMs,
            });
          },
          warn: (message) => {
            jsonLog("warning", message, { phase: "llm-trace", provider });
          },
        });
      } catch (error: unknown) {
        agentTaskRunsTotal.inc({ provider, outcome: "sdk_failed" });
        agentTaskSdkRunsTotal.inc({
          provider,
          model: config.model,
          outcome: "failed",
        });
        const classified =
          error instanceof AgentTaskSdkExecutionError
            ? asNonRetryableSdkFailure(error)
            : error;
        captureWithContext(classified, {
          provider,
          model: config.model,
          phase: "agent-sdk",
          generationStarted:
            error instanceof AgentTaskSdkExecutionError
              ? error.generationStarted
              : undefined,
          possiblyAppliedEffects:
            error instanceof AgentTaskSdkExecutionError
              ? error.possiblyAppliedEffects
              : undefined,
        });
        throw classified;
      } finally {
        clearInterval(mountedSecretRefreshTimer);
        clearInterval(heartbeatTimer);
        if (timeout.timer !== undefined) {
          clearTimeout(timeout.timer);
        }
      }

      try {
        await secretTokenState.refresh();
      } catch (error: unknown) {
        redactionFailureController.record(error);
      }
      throwIfAgentTaskSecretRedactionFailed(
        redactionFailureController.failure,
        {
          provider,
          durationMs: result.durationMs,
          signal: cancellationSignal.aborted ? "aborted" : "none",
        },
      );

      agentSubprocessIdleSeconds.observe(
        { workflow_type: workflowType },
        Math.max(maxIdleMs, result.maxIdleMs) / 1000,
      );
      agentTaskSdkDurationSeconds.observe(
        { provider, model: config.model, outcome: "success" },
        result.durationMs / 1000,
      );
      agentTaskSdkRunsTotal.inc({
        provider,
        model: config.model,
        outcome: "success",
      });
      span.setAttributes({
        "agent.duration_ms": result.durationMs,
        "agent.max_idle_ms": result.maxIdleMs,
        "agent.event_count": result.eventCount,
        "agent.generation_started": result.generationStarted,
        "agent.possibly_applied_effects": result.possiblyAppliedEffects,
        "gen_ai.usage.input_tokens": result.usage.inputTokens,
        "gen_ai.usage.output_tokens": result.usage.outputTokens,
        "gen_ai.usage.cache_read_input_tokens": result.usage.cachedInputTokens,
        "gen_ai.usage.cache_write_input_tokens":
          result.usage.cacheWriteInputTokens,
        "gen_ai.usage.reasoning_tokens": result.usage.reasoningTokens,
      });
      if (result.sessionId !== undefined) {
        span.setAttribute("gen_ai.conversation.id", result.sessionId);
      }
      if (result.costUsd !== undefined) {
        span.setAttribute("gen_ai.usage.cost", result.costUsd);
      }

      const redactTokens = secretTokenState.tokens;
      let decodedPayload: AgentTaskResultPayload | AgentTaskResultPayloadV2;
      try {
        decodedPayload = decodeAgentTaskPayload({
          provider,
          structuredOutput: result.output,
          finalText: result.finalText,
          schemaFingerprint: config.schemaFingerprint,
          contractVersion: config.contractVersion,
          durationMs: result.durationMs,
          redact: (value) => redactSecrets(value, redactTokens),
        });
      } catch (error: unknown) {
        // The agent already spent its tokens and may already have run tools.
        // Replaying it cannot fix an invalid schema, so fail the activity for
        // good rather than letting Temporal retry an effectful run.
        throw ApplicationFailure.create({
          message: `${provider} native agent completed, but its structured output failed validation: ${error instanceof Error ? error.message : String(error)}`,
          ...(error instanceof Error ? { cause: error } : {}),
          nonRetryable: true,
          type: "AgentSdkOutputContractFailure",
        });
      }
      if (input.recordSuccess !== false) {
        agentTaskRunsTotal.inc({ provider, outcome: "success" });
      }

      // Receipts come from the SDK's own already-redacted event stream, so a
      // claimed tool call that never produced an event cannot be cited.
      const evidence = extractAgentTaskEvidenceReceipts(
        result.evidenceEvents,
        provider,
        new Date().toISOString(),
        (value) => redactSecrets(value, redactTokens),
      );

      jsonLog("info", "Agent task completed", {
        provider,
        title: parsed.title,
        model: config.model,
        durationMs: result.durationMs,
        sessionId: result.sessionId,
        tokens: result.usage,
        costUsd: result.costUsd,
        contractVersion: config.contractVersion,
        evidenceReceiptCount: evidence.length,
      });

      const base = {
        provider,
        model: config.model,
        durationMs: result.durationMs,
        startedAt: new Date(startedAtMs).toISOString(),
        evidence,
      };
      if (config.contractVersion === 2) {
        return {
          ...base,
          contractVersion: 2,
          payload: AgentTaskResultPayloadV2Schema.parse(decodedPayload),
        };
      }
      const payload = AgentTaskResultPayloadSchema.parse(decodedPayload);
      return {
        ...base,
        ...payload,
        contractVersion: 1,
        payload,
      };
    },
  );
}

function requireV2Result(result: RunAgentTaskResult): RunAgentTaskResultV2 {
  if (result.contractVersion !== 2) {
    throw new Error("two-phase execution requires agent task contract v2");
  }
  return result;
}

async function investigateAgentTask(
  input: RunAgentTaskInput,
  sdkRunner: AgentTaskSdkRunner,
  evidenceCollector: typeof collectDeclaredAgentTaskEvidence,
): Promise<RunAgentTaskResultV2> {
  const investigation = requireV2Result(
    await runAgent(
      {
        ...input,
        phase: { kind: "investigation" },
        recordSuccess: false,
      },
      sdkRunner,
    ),
  );
  const declaredEvidence = await evidenceCollector(input.input, input.workdir);
  return {
    ...investigation,
    evidence: mergeAgentTaskEvidence(investigation.evidence, declaredEvidence),
  };
}

async function finalizeAgentTask(
  input: FinalizeAgentTaskInput,
  sdkRunner: AgentTaskSdkRunner,
): Promise<RunAgentTaskResultV2> {
  const finalized = requireV2Result(
    await runAgent(
      {
        input: input.input,
        workdir: input.workdir,
        phase: {
          kind: "finalization",
          evidence: input.investigation.evidence,
          preliminary: input.investigation.payload,
        },
      },
      sdkRunner,
    ),
  );
  return {
    ...finalized,
    durationMs: input.investigation.durationMs + finalized.durationMs,
    startedAt: input.investigation.startedAt,
    evidence: input.investigation.evidence,
  };
}

export function createAgentTaskActivities(
  sdkRunner: AgentTaskSdkRunner = runAgentTaskSdk,
  evidenceCollector: typeof collectDeclaredAgentTaskEvidence = collectDeclaredAgentTaskEvidence,
) {
  return {
    prepareAgentTaskWorkdir,
    runAgentTask: (input: RunAgentTaskInput) => runAgent(input, sdkRunner),
    investigateAgentTask: (input: RunAgentTaskInput) =>
      investigateAgentTask(input, sdkRunner, evidenceCollector),
    finalizeAgentTask: (input: FinalizeAgentTaskInput) =>
      finalizeAgentTask(input, sdkRunner),
    sendAgentTaskEmail: sendEmail,
    sendAgentTaskFailureReport: sendFailureReport,
    scheduleAgentTaskFollowUp: scheduleFollowUp,
    pauseAgentTaskSchedule: pauseSchedule,
    cleanupAgentTaskWorkdir: cleanup,
  };
}

export const agentTaskActivities = createAgentTaskActivities();
export type AgentTaskActivities = typeof agentTaskActivities;
