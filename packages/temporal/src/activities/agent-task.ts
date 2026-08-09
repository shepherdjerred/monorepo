import { agentSubprocessFailure } from "#activities/agent-task-failures.ts";
import {
  agentSubprocessIdleSeconds,
  agentSubprocessSoftKillsTotal,
  agentTaskOutputContractFailuresTotal,
  agentTaskRunsTotal,
  agentTaskSubprocessDurationSeconds,
  agentTaskSubprocessExitTotal,
} from "#observability/metrics.ts";
import { withSpan } from "#observability/tracing.ts";
import { provisionWorkdir } from "#lib/pr-review-workdir.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { buildAgentTaskCommand } from "#activities/agent-task-command.ts";
import {
  createAgentTaskSecretTokenState,
  AgentTaskSecretRedactionController,
  envForProvider,
  refreshAgentTaskSecretTokenStateInBackground,
} from "#activities/agent-task-env.ts";
import { runTrackedAgentSubprocess } from "#shared/agent-subprocess.ts";
import { summarizeClaudeStreamLine } from "#shared/claude-result.ts";
import {
  AgentTaskInputSchema,
  parseAgentTaskResultPayload,
  parseClaudeAgentTaskResult,
  AgentTaskOutputContractError,
  type AgentTaskInput,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
} from "#shared/agent-task.ts";
import { redactSecrets } from "#shared/redact.ts";
import { startAgentTaskLlmTrace } from "#activities/agent-task-llm-trace.ts";
import type { TrackedAgentResult } from "#shared/agent-subprocess.ts";
import {
  activityCancellationSignalOrUndefined,
  captureWithContext,
  currentWorkflowType,
  jsonLog,
  safeHeartbeat,
  startToCloseTimeoutMsOrUndefined,
  throwIfAgentTaskSecretRedactionFailed,
  workflowId,
} from "#activities/agent-task-runtime.ts";
import {
  cleanup,
  pauseSchedule,
  scheduleFollowUp,
  sendEmail,
} from "./agent-task-side-activities.ts";
const HEARTBEAT_INTERVAL_MS = 10_000;
const MOUNTED_SECRET_REFRESH_INTERVAL_MS = 10_000;

export type PrepareAgentTaskWorkdirInput = {
  input: AgentTaskInput;
};
export type PrepareAgentTaskWorkdirResult = {
  workdir: string;
};
export type RunAgentTaskInput = {
  input: AgentTaskInput;
  workdir: string;
};
export type RunAgentTaskResult = AgentTaskResultPayload & {
  provider: AgentTaskProvider;
  model: string;
  durationMs: number;
};
function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo, extra] = fullName.split("/");
  if (owner === undefined || repo === undefined || extra !== undefined) {
    throw new Error(`Invalid repo fullName: ${fullName}`);
  }
  return { owner, repo };
}
async function runAgent(
  input: RunAgentTaskInput,
  commandBuilder: typeof buildAgentTaskCommand,
): Promise<RunAgentTaskResult> {
  const parsed = AgentTaskInputSchema.parse(input.input);
  const provider = parsed.provider;
  const command = await commandBuilder(parsed, input.workdir);
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
      const githubTokenResult = await createGitHubAppInstallationToken();
      const secretTokenState = await createAgentTaskSecretTokenState(
        githubTokenResult.token,
      );
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
            env: envForProvider(provider, githubTokenResult.token),
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

      throwIfAgentTaskSecretRedactionFailed(
        redactionFailureController.failure,
        {
          provider,
          durationMs: result.durationMs,
          signal: result.signal,
        },
      );

      // Post-hoc Claude spans retain raw stdout in the LLM archive. Check the
      // final redaction state first so a refresh failure can never archive a
      // newly rotated credential from that raw buffer. Other failed runs are
      // still traced because their stdout is safe to retain.
      llmTrace.record({
        stdout: result.stdout,
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

      let payload: AgentTaskResultPayload;
      try {
        if (provider === "claude") {
          payload = parseClaudeAgentTaskResult(result.stdout, (excerpt) =>
            redactSecrets(excerpt, secretTokens),
          );
        } else {
          if (command.outputPath === undefined) {
            throw new Error(
              "Codex agent task completed without an output path",
            );
          }
          payload = parseAgentTaskResultPayload(
            await Bun.file(command.outputPath).text(),
            provider,
          );
        }
      } catch (error: unknown) {
        agentTaskRunsTotal.inc({ provider, outcome: "parse_failed" });
        const contractDiagnostics =
          error instanceof AgentTaskOutputContractError
            ? error.diagnostics
            : undefined;
        if (error instanceof AgentTaskOutputContractError) {
          agentTaskOutputContractFailuresTotal.inc({
            provider,
            reason: error.reason,
          });
          jsonLog("warning", "Agent task output contract failed", {
            provider,
            outputContractReason: error.reason,
            ...error.diagnostics,
          });
        }
        captureWithContext(error, {
          provider,
          durationMs: result.durationMs,
          phase: "parse-output",
          schemaFingerprint: contractDiagnostics?.schemaFingerprint,
          outputContractReason:
            error instanceof AgentTaskOutputContractError
              ? error.reason
              : undefined,
          resultSubtype: contractDiagnostics?.resultSubtype,
          resultMessageKeys: contractDiagnostics?.resultMessageKeys,
          finalTextExcerpt: contractDiagnostics?.finalTextExcerpt,
        });
        throw error;
      }
      agentTaskRunsTotal.inc({ provider, outcome: "success" });

      jsonLog("info", "Agent task completed", {
        provider,
        title: parsed.title,
        durationMs: result.durationMs,
        markdownLength: payload.markdown.length,
        requestedFollowUp: payload.followUp !== undefined,
        requestedCancelCron: payload.cancelCron === true,
      });

      return {
        ...payload,
        provider,
        model: command.model,
        durationMs: result.durationMs,
      };
    },
  );
}

async function prepareWorkdir(
  input: PrepareAgentTaskWorkdirInput,
): Promise<PrepareAgentTaskWorkdirResult> {
  const parsed = AgentTaskInputSchema.parse(input.input);
  const { owner, repo } = splitRepo(parsed.repo.fullName);
  const tokenResult = await createGitHubAppInstallationToken();
  const workdir = await provisionWorkdir({
    workflowId: workflowId(),
    owner,
    repo,
    ref: parsed.repo.ref ?? "main",
    env: { GH_TOKEN: tokenResult.token },
  });
  return { workdir };
}

export function createAgentTaskActivities(
  commandBuilder: typeof buildAgentTaskCommand = buildAgentTaskCommand,
) {
  return {
    prepareAgentTaskWorkdir: prepareWorkdir,
    runAgentTask: (input: RunAgentTaskInput) => runAgent(input, commandBuilder),
    sendAgentTaskEmail: sendEmail,
    scheduleAgentTaskFollowUp: scheduleFollowUp,
    pauseAgentTaskSchedule: pauseSchedule,
    cleanupAgentTaskWorkdir: cleanup,
  };
}

export const agentTaskActivities = createAgentTaskActivities();

export type AgentTaskActivities = typeof agentTaskActivities;
