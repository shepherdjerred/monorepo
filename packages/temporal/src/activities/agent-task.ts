import { Context } from "@temporalio/activity";
import * as Sentry from "@sentry/bun";
import { createTemporalClient } from "#client";
import {
  agentTaskEmailSentTotal,
  agentTaskRunsTotal,
  agentTaskSubprocessDurationSeconds,
  agentTaskSubprocessExitTotal,
} from "#observability/metrics.ts";
import { getTraceContext } from "#observability/tracing.ts";
import { cleanupWorkdir, provisionWorkdir } from "#lib/pr-review-workdir.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { startOrScheduleAgentTask } from "#lib/agent-task-scheduler.ts";
import { buildAgentTaskCommand } from "#activities/agent-task-command.ts";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import { parseClaudeResultMessage } from "#shared/claude-result.ts";
import {
  AgentTaskInputSchema,
  AgentTaskResultPayloadSchema,
  type AgentTaskFollowUp,
  type AgentTaskInput,
  type AgentTaskProvider,
  type AgentTaskResultPayload,
  type AgentTaskStartResult,
} from "#shared/agent-task.ts";
import { renderAuditMarkdownToHtml } from "#shared/markdown-to-html.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import { redactSecrets } from "#shared/redact.ts";

const COMPONENT = "agent-task";
const HEARTBEAT_INTERVAL_MS = 10_000;

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

export type SendAgentTaskEmailInput = {
  input: AgentTaskInput;
  result: RunAgentTaskResult;
};

export type SendAgentTaskEmailResult = {
  subject: string;
  messageId: string;
  recipientId: number | "unknown";
};

export type ScheduleAgentTaskFollowUpInput = {
  parent: AgentTaskInput;
  followUp: AgentTaskFollowUp;
};

export type PauseAgentTaskScheduleInput = {
  scheduleId: string;
  reason: string;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  const info = activityInfoOrUndefined();
  const base: Record<string, unknown> = {
    level,
    msg: message,
    component: COMPONENT,
    ...getTraceContext(),
    ...fields,
  };
  if (info !== undefined) {
    Object.assign(base, info);
  }
  console.warn(JSON.stringify(base));
}

function activityInfoOrUndefined(): Record<string, unknown> | undefined {
  try {
    const info = Context.current().info;
    return {
      workflow: info.workflowType,
      ...workflowExecutionContext(info),
      activity: info.activityType,
      attempt: info.attempt,
    };
  } catch {
    return undefined;
  }
}

function captureWithContext(
  error: unknown,
  extra: Record<string, unknown> = {},
): void {
  Sentry.withScope((scope) => {
    scope.setTag("component", COMPONENT);
    const info = activityInfoOrUndefined();
    if (info !== undefined) {
      scope.setTag("workflow", String(info["workflow"]));
      scope.setTag("activity", String(info["activity"]));
    }
    scope.setContext("agentTask", { ...info, ...extra });
    Sentry.captureException(error);
  });
}

function safeHeartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    // Local scripts can call activities directly; outside Temporal this is a no-op.
  }
}

function workflowId(): string {
  try {
    return (
      Context.current().info.workflowExecution?.workflowId ??
      `agent-task-local-${crypto.randomUUID()}`
    );
  } catch {
    return `agent-task-local-${crypto.randomUUID()}`;
  }
}

function secretTokens(
  githubAppToken: string | undefined,
): readonly (string | undefined)[] {
  return [
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"],
    Bun.env["ANTHROPIC_API_KEY"],
    Bun.env["OPENAI_API_KEY"],
    Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"],
    Bun.env["GITHUB_APP_PRIVATE_KEY"],
    githubAppToken,
    Bun.env["POSTAL_API_KEY"],
    Bun.env["PAGERDUTY_TOKEN"],
    Bun.env["BUGSINK_TOKEN"],
    Bun.env["GRAFANA_API_KEY"],
    Bun.env["ARGOCD_AUTH_TOKEN"],
    Bun.env["CLOUDFLARE_API_TOKEN"],
  ];
}

function envForProvider(
  provider: AgentTaskProvider,
  githubAppToken: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (provider === "claude" && key === "ANTHROPIC_API_KEY") {
      continue;
    }
    if (
      key === "GH_TOKEN" ||
      key === "GITHUB_PERSONAL_ACCESS_TOKEN" ||
      key.startsWith("GITHUB_APP_")
    ) {
      continue;
    }
    env[key] = value;
  }
  env["GH_TOKEN"] = githubAppToken;
  return env;
}

async function pumpStderr(
  stream: ReadableStream<Uint8Array>,
  tokens: readonly (string | undefined)[],
  provider: AgentTaskProvider,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        jsonLog("info", "agent stderr", {
          provider,
          line: redactSecrets(line, tokens),
        });
      }
    }
    if (buf.length > 0) {
      jsonLog("info", "agent stderr", {
        provider,
        line: redactSecrets(buf, tokens),
      });
    }
  } catch (error: unknown) {
    jsonLog("warning", "stderr pump error", {
      provider,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo, extra] = fullName.split("/");
  if (owner === undefined || repo === undefined || extra !== undefined) {
    throw new Error(`Invalid repo fullName: ${fullName}`);
  }
  return { owner, repo };
}

function parseAgentPayload(raw: string): AgentTaskResultPayload {
  try {
    return AgentTaskResultPayloadSchema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse agent task JSON payload: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function runAgent(input: RunAgentTaskInput): Promise<RunAgentTaskResult> {
  const parsed = AgentTaskInputSchema.parse(input.input);
  const provider = parsed.provider;
  const command = await buildAgentTaskCommand(parsed, input.workdir);

  jsonLog("info", "Invoking agent task", {
    provider,
    title: parsed.title,
    model: command.model,
    workdir: input.workdir,
  });

  const githubTokenResult = await createGitHubAppInstallationToken();
  const startMs = Date.now();
  const proc = Bun.spawn(command.args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.workdir,
    env: envForProvider(provider, githubTokenResult.token),
  });
  const heartbeat = setInterval(() => {
    safeHeartbeat({ phase: "agent", elapsedMs: Date.now() - startMs });
  }, HEARTBEAT_INTERVAL_MS);

  let stdout: string;
  let exitCode: number;
  try {
    [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      pumpStderr(proc.stderr, secretTokens(githubTokenResult.token), provider),
      proc.exited,
    ]);
  } finally {
    clearInterval(heartbeat);
  }

  const durationMs = Date.now() - startMs;
  agentTaskSubprocessDurationSeconds.observe(
    { provider, model: command.model, exit_code: String(exitCode) },
    durationMs / 1000,
  );
  agentTaskSubprocessExitTotal.inc({
    provider,
    exit_code: String(exitCode),
  });

  if (exitCode !== 0) {
    const error = new Error(
      `${provider} agent task exited with code ${String(exitCode)}`,
    );
    captureWithContext(error, { provider, durationMs });
    throw error;
  }

  let payload: AgentTaskResultPayload;
  if (provider === "claude") {
    payload = parseAgentPayload(parseClaudeResultMessage(stdout).result ?? "");
  } else {
    if (command.outputPath === undefined) {
      throw new Error("Codex agent task completed without an output path");
    }
    payload = parseAgentPayload(await Bun.file(command.outputPath).text());
  }

  agentTaskRunsTotal.inc({ provider, outcome: "success" });
  jsonLog("info", "Agent task completed", {
    provider,
    title: parsed.title,
    durationMs,
    markdownLength: payload.markdown.length,
    requestedFollowUp: payload.followUp !== undefined,
    requestedCancelCron: payload.cancelCron === true,
  });

  return {
    ...payload,
    provider,
    model: command.model,
    durationMs,
  };
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

async function sendEmail(
  input: SendAgentTaskEmailInput,
): Promise<SendAgentTaskEmailResult> {
  const { recipient, sender } = resolvePostalAddresses();
  const date = new Date().toISOString().slice(0, 10);
  const prefix = input.input.emailSubjectPrefix ?? "Agent Task";
  const subject = `${prefix}: ${input.input.title} (${date})`;
  const body = [
    `# ${input.input.title}`,
    "",
    `Provider: ${input.result.provider}`,
    `Model: ${input.result.model}`,
    `Duration: ${String(Math.round(input.result.durationMs / 1000))}s`,
    "",
    input.result.markdown,
  ].join("\n");

  try {
    const result = await sendPostalEmail({
      to: recipient,
      from: sender,
      subject,
      htmlBody: renderAuditMarkdownToHtml(body),
      tag: "agent-task",
    });
    agentTaskEmailSentTotal.inc({ outcome: "success" });
    return {
      subject: result.subject,
      messageId: result.messageId,
      recipientId: result.recipientId,
    };
  } catch (error: unknown) {
    agentTaskEmailSentTotal.inc({ outcome: "failure" });
    captureWithContext(error, { subject });
    throw error;
  }
}

async function scheduleFollowUp(
  input: ScheduleAgentTaskFollowUpInput,
): Promise<AgentTaskStartResult> {
  const task = AgentTaskInputSchema.parse({
    title: input.followUp.title,
    prompt: input.followUp.prompt,
    provider: input.followUp.provider ?? input.parent.provider,
    mode: "report-only",
    repo: input.parent.repo,
    runAt: input.followUp.runAt,
    cron: input.followUp.cron,
    source: input.parent.source,
    model: input.followUp.model ?? input.parent.model,
    maxTurns: input.followUp.maxTurns ?? input.parent.maxTurns,
    allowSelfCancel: false,
    emailSubjectPrefix: input.parent.emailSubjectPrefix,
  });
  const client = await createTemporalClient();
  return await startOrScheduleAgentTask(client, task);
}

async function pauseSchedule(
  input: PauseAgentTaskScheduleInput,
): Promise<void> {
  const client = await createTemporalClient();
  const handle = client.schedule.getHandle(input.scheduleId);
  await handle.pause(input.reason);
  jsonLog("info", "Paused agent task schedule", {
    scheduleId: input.scheduleId,
    reason: input.reason,
  });
}

async function cleanup(input: PrepareAgentTaskWorkdirResult): Promise<void> {
  await cleanupWorkdir(input.workdir);
}

export type AgentTaskActivities = typeof agentTaskActivities;

export const agentTaskActivities = {
  prepareAgentTaskWorkdir: prepareWorkdir,
  runAgentTask: runAgent,
  sendAgentTaskEmail: sendEmail,
  scheduleAgentTaskFollowUp: scheduleFollowUp,
  pauseAgentTaskSchedule: pauseSchedule,
  cleanupAgentTaskWorkdir: cleanup,
};
