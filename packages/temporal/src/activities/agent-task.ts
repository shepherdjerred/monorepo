import { agentSubprocessFailure } from "#activities/agent-task-failures.ts";
import {
  agentSubprocessIdleSeconds,
  agentSubprocessSoftKillsTotal,
  agentTaskRunsTotal,
  agentTaskSubprocessDurationSeconds,
  agentTaskSubprocessExitTotal,
} from "#observability/metrics.ts";
import { withSpan } from "#observability/tracing.ts";
import { buildAgentTaskCommand } from "#activities/agent-task-command.ts";
import {
  createAgentTaskSecretTokenState,
  AgentTaskSecretRedactionController,
  type AgentTaskSecretRedactionError,
  envForProvider,
  refreshAgentTaskSecretTokenStateInBackground,
} from "#activities/agent-task-env.ts";
import { runTrackedAgentSubprocess } from "#shared/agent-subprocess.ts";
import { summarizeClaudeStreamLine } from "#shared/claude-result.ts";
import type { AgentTaskPromptPhase } from "#shared/agent-task-prompt.ts";
import {
  AgentTaskInputSchema,
  type AgentTaskInput,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
  AgentTaskResultPayloadSchema,
  AgentTaskResultPayloadV2Schema,
  type AgentTaskResultPayloadV2,
} from "#shared/agent-task.ts";
import { extractAgentTaskEvidenceReceipts } from "#shared/agent-task-evidence.ts";
import type { ReportEvidenceReceiptV1 } from "#shared/report.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  startAgentTaskLlmTrace,
  type AgentTaskLlmTrace,
} from "#activities/agent-task-llm-trace.ts";
import type { TrackedAgentResult } from "#shared/agent-subprocess.ts";
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
function enforceAgentTaskSecretRedactionHealth(input: {
  llmTrace: Pick<AgentTaskLlmTrace, "recordMetadataOnly">;
  failure: AgentTaskSecretRedactionError | undefined;
  result: Pick<TrackedAgentResult, "exitCode" | "durationMs" | "signal">;
  provider: string;
  startTimeMs: number;
}): void {
  if (input.failure !== undefined) {
    input.llmTrace.recordMetadataOnly({
      exitCode: input.result.exitCode,
      startTimeMs: input.startTimeMs,
      durationMs: input.result.durationMs,
    });
  }
  throwIfAgentTaskSecretRedactionFailed(input.failure, {
    provider: input.provider,
    durationMs: input.result.durationMs,
    signal: input.result.signal,
  });
}

async function runAgent(
  input: RunAgentTaskInput,
  commandBuilder: typeof buildAgentTaskCommand,
): Promise<RunAgentTaskResult> {
  const parsed = AgentTaskInputSchema.parse(input.input);
  const provider = parsed.provider;
  const phase = input.phase ?? { kind: "single" };
  const command = await commandBuilder(parsed, input.workdir, phase);
  const workflowType = currentWorkflowType();
  return withSpan(
    "agent-task.run-agent",
    {
      "agent.provider": provider,
      "agent.title": parsed.title,
      "agent.model": command.model,
      "agent.workdir": input.workdir,
      "agent.timeout_minutes": parsed.agentTimeoutMinutes ?? 0,
      "agent.max_turns": parsed.maxTurns ?? 0,
      "agent.phase": phase.kind,
    },
    async (span) => {
      jsonLog("info", "Invoking agent task", {
        phase: "spawn",
        provider,
        title: parsed.title,
        model: command.model,
        workdir: input.workdir,
        agentTimeoutMinutes: parsed.agentTimeoutMinutes,
        maxTurns: parsed.maxTurns,
      });
      const secretTokenState = await createAgentTaskSecretTokenState(undefined);
      const secretTokens = secretTokenState.tokens;
      const redactionFailureController = new AgentTaskSecretRedactionController(
        jsonLog.bind(
          null,
          "error",
          "Unable to refresh mounted agent-task secrets",
          {
            phase: "secret-redaction",
          },
        ),
      );
      const activityCancellationSignal =
        activityCancellationSignalOrUndefined();
      const cancellationSignal =
        activityCancellationSignal === undefined
          ? redactionFailureController.abortController.signal
          : AbortSignal.any([
              activityCancellationSignal,
              redactionFailureController.abortController.signal,
            ]);
      const llmStartMs = Date.now();
      const llmTrace = startAgentTaskLlmTrace({
        provider,
        callSite: "agent-task",
        model: command.model,
        prompt: command.prompt,
        options: {
          maxTurns: parsed.maxTurns,
          title: parsed.title,
          mode: parsed.mode,
        },
        warn: (message) => {
          jsonLog("warning", message, { phase: "llm-trace" });
        },
      });
      const refreshSecretsInBackground = (): void => {
        void refreshAgentTaskSecretTokenStateInBackground(
          secretTokenState,
          (error) => {
            redactionFailureController.record(error);
          },
        );
      };
      const mountedSecretRefreshTimer = setInterval(
        refreshSecretsInBackground,
        MOUNTED_SECRET_REFRESH_INTERVAL_MS,
      );
      const refreshSecretsBeforeOutput = async (): Promise<boolean> => {
        // Refresh immediately before every stdout chunk. The periodic refresh
        // is only a liveness aid; this boundary closes the rotation-to-output
        // race before a diagnostic excerpt is retained.
        if (redactionFailureController.failure !== undefined) {
          return false;
        }
        return redactionFailureController.refreshBeforeOutput(secretTokenState);
      };
      let result: TrackedAgentResult;
      try {
        result = await runTrackedAgentSubprocess(
          {
            command: command.args,
            cwd: input.workdir,
            env: envForProvider(provider, input.workdir),
            redactTokens: secretTokens,
            beforeOutput: refreshSecretsBeforeOutput,
            startToCloseTimeoutMs: startToCloseTimeoutMsOrUndefined(),
            cancellationSignal,
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
            onHeartbeat: (beat) => {
              safeHeartbeat({ phase: "agent", provider, ...beat });
              jsonLog("info", "agent heartbeat", {
                phase: "agent",
                provider,
                ...beat,
              });
              span.addEvent("agent.heartbeat", {
                elapsedMs: beat.elapsedMs,
                idleMs: beat.idleMs,
              });
            },
            onSoftKill: (event) => {
              jsonLog("warning", "agent soft-kill", {
                phase: "soft-kill",
                provider,
                ...event,
              });
              span.addEvent("agent.soft-kill", {
                elapsedMs: event.elapsedMs,
                idleMs: event.idleMs,
                maxIdleMs: event.maxIdleMs,
              });
              agentSubprocessSoftKillsTotal.inc({
                workflow_type: workflowType,
                reason: "pre_temporal_timeout",
              });
            },
            onSigkillEscalation: (event) => {
              jsonLog("warning", "agent sigkill escalation", {
                phase: "sigkill",
                provider,
                ...event,
              });
              agentSubprocessSoftKillsTotal.inc({
                workflow_type: workflowType,
                reason: "escalated_sigkill",
              });
            },
            onStdoutLine: (line) => {
              llmTrace.pushStdoutLine(line);
              const event = summarizeClaudeStreamLine(line);
              if (event !== undefined) {
                jsonLog("info", "agent event", {
                  phase: "agent-event",
                  provider,
                  ...event,
                });
                span.addEvent("agent.event", { type: event.type });
              }
            },
            onStderrLine: (line) => {
              jsonLog("info", "agent stderr", { provider, line });
            },
            onCancellation: (state) => {
              jsonLog(
                "warning",
                "Agent task cancellation requested; killing subprocess",
                {
                  provider,
                  title: parsed.title,
                  model: command.model,
                  ...state,
                },
              );
            },
          },
          redactSecrets,
        );
      } finally {
        clearInterval(mountedSecretRefreshTimer);
        // Close codex spans on every exit path (incl. spawn failure) so a
        // crashed run still shows up in Tempo with whatever turns completed.
        llmTrace.close();
      }
      try {
        await secretTokenState.refresh();
      } catch (error: unknown) {
        redactionFailureController.record(error);
      }

      enforceAgentTaskSecretRedactionHealth({
        llmTrace,
        failure: redactionFailureController.failure,
        result,
        provider,
        startTimeMs: llmStartMs,
      });

      // Post-hoc Claude spans retain raw stdout in the LLM archive. Check the
      // final redaction state first so a refresh failure can never archive a
      // newly rotated credential from that raw buffer. Keep the raw stdout for
      // contract parsing below, but pass a token-redacted copy to the archive
      // so credentials that are not covered by the observability package's
      // generic patterns cannot be persisted. Other failed runs are still
      // traced because their stdout is safe to retain.
      llmTrace.record({
        stdout: redactSecrets(result.stdout, secretTokens),
        exitCode: result.exitCode,
        startTimeMs: llmStartMs,
        durationMs: result.durationMs,
      });

      const cancelled = result.signal === "SIGTERM";
      agentSubprocessIdleSeconds.observe(
        { workflow_type: workflowType },
        result.maxIdleMs / 1000,
      );
      agentTaskSubprocessDurationSeconds.observe(
        {
          provider,
          model: command.model,
          exit_code: cancelled ? "cancelled" : String(result.exitCode),
        },
        result.durationMs / 1000,
      );
      agentTaskSubprocessExitTotal.inc({
        provider,
        exit_code: cancelled ? "cancelled" : String(result.exitCode),
      });
      span.setAttribute("agent.duration_ms", result.durationMs);
      span.setAttribute("agent.max_idle_ms", result.maxIdleMs);
      span.setAttribute("agent.exit_code", result.exitCode);
      span.setAttribute("agent.signal", result.signal);

      jsonLog("info", "agent exited", {
        phase: "exited",
        provider,
        elapsedMs: result.durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        maxIdleMs: result.maxIdleMs,
        firstOutputLatencyMs: result.firstOutputLatencyMs,
        sigkillEscalated: result.sigkillEscalated,
        lastLine: result.lastLine,
      });

      if (cancelled) {
        agentTaskRunsTotal.inc({ provider, outcome: "cancelled" });
        const error = new Error(`${provider} agent task cancelled`);
        captureWithContext(error, {
          provider,
          durationMs: result.durationMs,
          maxIdleMs: result.maxIdleMs,
          firstOutputLatencyMs: result.firstOutputLatencyMs,
          signal: result.signal,
          lastLine: result.lastLine,
        });
        throw error;
      }

      if (result.exitCode !== 0) {
        agentTaskRunsTotal.inc({ provider, outcome: "subprocess_failed" });
        const error = agentSubprocessFailure(provider, result);
        captureWithContext(error, {
          provider,
          durationMs: result.durationMs,
          maxIdleMs: result.maxIdleMs,
          firstOutputLatencyMs: result.firstOutputLatencyMs,
          signal: result.signal,
          lastLine: result.lastLine,
        });
        throw error;
      }

      const contractVersion = parsed.contractVersion === 2 ? 2 : 1;
      const decodedPayload = await decodeAgentTaskPayload({
        provider,
        stdout: result.stdout,
        outputPath: command.outputPath,
        contractVersion,
        durationMs: result.durationMs,
        redact: (excerpt) => redactSecrets(excerpt, secretTokens),
      });
      if (input.recordSuccess !== false) {
        agentTaskRunsTotal.inc({ provider, outcome: "success" });
      }

      const evidence = extractAgentTaskEvidenceReceipts(
        result.stdout,
        provider,
        new Date().toISOString(),
        (value) => redactSecrets(value, secretTokens),
      );

      jsonLog("info", "Agent task completed", {
        provider,
        title: parsed.title,
        durationMs: result.durationMs,
        contractVersion,
        evidenceReceiptCount: evidence.length,
      });

      const base = {
        provider,
        model: command.model,
        durationMs: result.durationMs,
        startedAt: new Date(llmStartMs).toISOString(),
        evidence,
      };
      if (contractVersion === 2) {
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
  commandBuilder: typeof buildAgentTaskCommand,
): Promise<RunAgentTaskResultV2> {
  return requireV2Result(
    await runAgent(
      {
        ...input,
        phase: { kind: "investigation" },
        recordSuccess: false,
      },
      commandBuilder,
    ),
  );
}

async function finalizeAgentTask(
  input: FinalizeAgentTaskInput,
  commandBuilder: typeof buildAgentTaskCommand,
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
      commandBuilder,
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
  commandBuilder: typeof buildAgentTaskCommand = buildAgentTaskCommand,
) {
  return {
    prepareAgentTaskWorkdir,
    runAgentTask: (input: RunAgentTaskInput) => runAgent(input, commandBuilder),
    investigateAgentTask: (input: RunAgentTaskInput) =>
      investigateAgentTask(input, commandBuilder),
    finalizeAgentTask: (input: FinalizeAgentTaskInput) =>
      finalizeAgentTask(input, commandBuilder),
    sendAgentTaskEmail: sendEmail,
    sendAgentTaskFailureReport: sendFailureReport,
    scheduleAgentTaskFollowUp: scheduleFollowUp,
    pauseAgentTaskSchedule: pauseSchedule,
    cleanupAgentTaskWorkdir: cleanup,
  };
}

export const agentTaskActivities = createAgentTaskActivities();

export type AgentTaskActivities = typeof agentTaskActivities;
