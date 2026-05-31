import { Context } from "@temporalio/activity";
import { z } from "zod/v4";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { cleanupWorkdir, provisionWorkdir } from "#lib/pr-review-workdir.ts";
import { parseClaudeResultMessage } from "#shared/claude-result.ts";
import { parseJsonArray } from "#shared/json.ts";
import { renderAuditMarkdownToHtml } from "#shared/markdown-to-html.ts";
import { resolvePostalAddresses, sendPostalEmail } from "#shared/postal.ts";
import { redactSecrets } from "#shared/redact.ts";
import {
  AlertRemediationAgentPayloadSchema,
  AlertRemediationChildInputSchema,
  alertRemediationWorkflowId,
  sanitizeAlertIdPart,
  type AlertRemediationAgentPayload,
  type AlertRemediationChildInput,
  type AlertRemediationChildResult,
  type AlertRemediationCollectionResult,
  type AlertRemediationSweepInput,
  type AlertRemediationSweepResult,
  type NormalizedAlert,
} from "#shared/alert-remediation.ts";
import { collectAlertRemediationAlertsWithDeps } from "./alert-remediation-collect.ts";
import { buildAlertRemediationCommand } from "./alert-remediation-command.ts";
import { defaultAlertRemediationDeps } from "./alert-remediation-runtime.ts";

const COMPONENT = "alert-remediation";
const HEARTBEAT_INTERVAL_MS = 10_000;

const OpenPrCliSchema = z
  .object({
    number: z.number(),
    title: z.string(),
    url: z.url(),
    isDraft: z.boolean().optional(),
    headRefName: z.string().optional(),
    body: z.string().nullable().optional(),
  })
  .loose();

export type FindExistingAlertRemediationPrInput = {
  alert: NormalizedAlert;
  repo: AlertRemediationSweepInput["repo"];
};

export type FindExistingAlertRemediationPrResult =
  | {
      found: false;
    }
  | {
      found: true;
      prUrl: string;
      branchName: string | undefined;
      title: string;
    };

export type PrepareAlertRemediationWorkdirInput = {
  input: AlertRemediationChildInput;
};

export type PrepareAlertRemediationWorkdirResult = {
  workdir: string;
};

export type RunAlertRemediationAgentInput = {
  input: AlertRemediationChildInput;
  workdir: string;
};

export type CleanupAlertRemediationWorkdirInput = {
  workdir: string;
};

export type SendAlertRemediationSweepEmailInput = {
  input: AlertRemediationSweepInput;
  result: AlertRemediationSweepResult;
};

export type SendAlertRemediationSweepEmailResult = {
  sent: boolean;
  subject: string | undefined;
  messageId: string | undefined;
};

function jsonLog(
  level: "info" | "warning" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  console.warn(
    JSON.stringify({
      level,
      msg: message,
      component: COMPONENT,
      ...fields,
    }),
  );
}

async function collectAlerts(
  rawInput: AlertRemediationSweepInput,
): Promise<AlertRemediationCollectionResult> {
  return await collectAlertRemediationAlertsWithDeps(rawInput);
}

async function findExistingPr(
  input: FindExistingAlertRemediationPrInput,
): Promise<FindExistingAlertRemediationPrResult> {
  const tokenResult = await createGitHubAppInstallationToken();
  const branchName = alertRemediationWorkflowId(input.alert);
  const raw = await defaultAlertRemediationDeps.runCommand({
    command: [
      "gh",
      "pr",
      "list",
      "--repo",
      input.repo.fullName,
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,url,isDraft,headRefName,body",
    ],
    cwd: "/tmp",
    env: { GH_TOKEN: tokenResult.token },
    redactOutput: true,
  });
  return existingPrFromSearch(raw, {
    fingerprint: input.alert.fingerprint,
    branchName,
  });
}

export function existingPrFromSearch(
  raw: string,
  needle?: { fingerprint: string; branchName: string },
): FindExistingAlertRemediationPrResult {
  const prs = parseJsonArray(raw, OpenPrCliSchema, "GitHub PR list");
  const pr =
    needle === undefined
      ? prs[0]
      : prs.find(
          (candidate) =>
            candidate.headRefName === needle.branchName ||
            candidate.body?.includes(needle.fingerprint) === true ||
            candidate.title.includes(needle.fingerprint),
        );
  if (pr === undefined) {
    return { found: false };
  }
  return {
    found: true,
    prUrl: pr.url,
    branchName: pr.headRefName,
    title: pr.title,
  };
}

function splitRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo, extra] = fullName.split("/");
  if (owner === undefined || repo === undefined || extra !== undefined) {
    throw new Error(`Invalid repo fullName: ${fullName}`);
  }
  return { owner, repo };
}

function workflowId(): string {
  try {
    return (
      Context.current().info.workflowExecution?.workflowId ??
      `alert-remediation-local-${crypto.randomUUID()}`
    );
  } catch {
    return `alert-remediation-local-${crypto.randomUUID()}`;
  }
}

async function prepareWorkdir(
  input: PrepareAlertRemediationWorkdirInput,
): Promise<PrepareAlertRemediationWorkdirResult> {
  const parsed = AlertRemediationChildInputSchema.parse(input.input);
  const { owner, repo } = splitRepo(parsed.repo.fullName);
  const tokenResult = await createGitHubAppInstallationToken();
  const workdir = await provisionWorkdir({
    workflowId: `${workflowId()}-${sanitizeAlertIdPart(parsed.alert.fingerprint)}`,
    owner,
    repo,
    ref: parsed.repo.ref,
    env: { GH_TOKEN: tokenResult.token },
  });
  return { workdir };
}

function secretTokens(githubAppToken: string | undefined) {
  return [
    Bun.env["CLAUDE_CODE_OAUTH_TOKEN"],
    Bun.env["ANTHROPIC_API_KEY"],
    Bun.env["OPENAI_API_KEY"],
    Bun.env["GITHUB_PERSONAL_ACCESS_TOKEN"],
    Bun.env["GITHUB_APP_PRIVATE_KEY"],
    githubAppToken,
  ];
}

function agentEnv(githubAppToken: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (typeof value !== "string") {
      continue;
    }
    if (key === "ANTHROPIC_API_KEY") {
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
  env["GIT_TERMINAL_PROMPT"] = "0";
  env["GIT_AUTHOR_NAME"] = env["GIT_AUTHOR_NAME"] ?? "Temporal Alert Bot";
  env["GIT_AUTHOR_EMAIL"] = env["GIT_AUTHOR_EMAIL"] ?? "ci@sjer.red";
  env["GIT_COMMITTER_NAME"] = env["GIT_COMMITTER_NAME"] ?? "Temporal Alert Bot";
  env["GIT_COMMITTER_EMAIL"] = env["GIT_COMMITTER_EMAIL"] ?? "ci@sjer.red";
  return env;
}

function parseAgentPayload(raw: string): AlertRemediationAgentPayload {
  try {
    const payload = AlertRemediationAgentPayloadSchema.parse(JSON.parse(raw));
    if (payload.outcome === "pr-created" && payload.prUrl === undefined) {
      throw new Error("pr-created output must include prUrl");
    }
    return payload;
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse alert-remediation JSON payload: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function heartbeat(payload: Record<string, unknown>): void {
  try {
    Context.current().heartbeat(payload);
  } catch {
    jsonLog("info", "Skipping heartbeat outside Temporal activity");
  }
}

function activityCancellationSignalOrUndefined(): AbortSignal | undefined {
  try {
    return Context.current().cancellationSignal;
  } catch {
    return undefined;
  }
}

async function pumpStderr(
  stream: ReadableStream<Uint8Array>,
  tokens: readonly (string | undefined)[],
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
        if (line.length > 0) {
          jsonLog("info", "agent stderr", {
            line: redactSecrets(line, tokens),
          });
        }
      }
    }
  } finally {
    if (buf.length > 0) {
      jsonLog("info", "agent stderr", {
        line: redactSecrets(buf, tokens),
      });
    }
  }
}

async function runAgent(
  input: RunAlertRemediationAgentInput,
): Promise<AlertRemediationChildResult> {
  const parsed = AlertRemediationChildInputSchema.parse(input.input);
  const command = await buildAlertRemediationCommand(parsed, input.workdir);
  const tokenResult = await createGitHubAppInstallationToken();
  const startMs = Date.now();
  const proc = Bun.spawn(command.args, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: input.workdir,
    env: agentEnv(tokenResult.token),
  });
  const interval = setInterval(() => {
    heartbeat({ phase: "agent", elapsedMs: Date.now() - startMs });
  }, HEARTBEAT_INTERVAL_MS);
  const cancellationSignal = activityCancellationSignalOrUndefined();
  const abort = (): void => {
    proc.kill();
  };
  cancellationSignal?.addEventListener("abort", abort, { once: true });

  let stdout: string;
  let exitCode: number;
  try {
    [stdout, , exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      pumpStderr(proc.stderr, secretTokens(tokenResult.token)),
      proc.exited,
    ]);
  } finally {
    clearInterval(interval);
    cancellationSignal?.removeEventListener("abort", abort);
  }

  if (exitCode !== 0) {
    throw new Error(
      `alert-remediation agent exited with code ${String(exitCode)}`,
    );
  }

  const payload =
    parsed.provider === "claude"
      ? parseAgentPayload(parseClaudeResultMessage(stdout).result ?? "")
      : parseAgentPayload(
          command.outputPath === undefined
            ? ""
            : await Bun.file(command.outputPath).text(),
        );

  return {
    source: parsed.alert.source,
    fingerprint: parsed.alert.fingerprint,
    title: parsed.alert.title,
    outcome: payload.outcome,
    decision: payload.decision,
    reason: payload.reason,
    markdown: payload.markdown,
    prUrl: payload.prUrl,
    branchName: payload.branchName,
    verificationCommands: payload.verificationCommands,
  };
}

async function cleanup(
  input: CleanupAlertRemediationWorkdirInput,
): Promise<void> {
  await cleanupWorkdir(input.workdir);
}

function shouldEmail(result: AlertRemediationSweepResult): boolean {
  return (
    result.collectionFailures.length > 0 ||
    result.outcomes.some((outcome) => outcome.outcome !== "report-only")
  );
}

function formatOutcome(outcome: AlertRemediationChildResult): string {
  const lines = [
    `### ${outcome.source}: ${outcome.title}`,
    "",
    `- Fingerprint: \`${outcome.fingerprint}\``,
    `- Outcome: ${outcome.outcome}`,
    `- Decision: ${outcome.decision}`,
    `- Reason: ${outcome.reason}`,
  ];
  if (outcome.prUrl !== undefined) {
    lines.push(`- PR: ${outcome.prUrl}`);
  }
  if (outcome.branchName !== undefined) {
    lines.push(`- Branch: \`${outcome.branchName}\``);
  }
  if (outcome.verificationCommands.length > 0) {
    lines.push(
      `- Verification: ${outcome.verificationCommands.map((command) => `\`${command}\``).join(", ")}`,
    );
  }
  lines.push("", outcome.markdown);
  return lines.join("\n");
}

async function sendSweepEmail(
  input: SendAlertRemediationSweepEmailInput,
): Promise<SendAlertRemediationSweepEmailResult> {
  if (!shouldEmail(input.result)) {
    return { sent: false, subject: undefined, messageId: undefined };
  }
  const { recipient, sender } = resolvePostalAddresses();
  const date = defaultAlertRemediationDeps.now().toISOString().slice(0, 10);
  const subject = `Alert Remediation: ${date}`;
  const failureLines = input.result.collectionFailures.map(
    (failureItem) => `- ${failureItem.source}: ${failureItem.reason}`,
  );
  const body = [
    "# Alert Remediation Sweep",
    "",
    `Repository: ${input.input.repo.fullName}@${input.input.repo.ref}`,
    `Inspected alerts: ${String(input.result.inspectedAlerts)}`,
    `Started children: ${String(input.result.startedChildren)}`,
    `Skipped duplicate alerts: ${String(input.result.skippedDuplicateAlerts)}`,
    "",
    "## Collection Failures",
    "",
    failureLines.length === 0 ? "None." : failureLines.join("\n"),
    "",
    "## Outcomes",
    "",
    input.result.outcomes.length === 0
      ? "No child workflows produced outcomes."
      : input.result.outcomes
          .map((outcome) => formatOutcome(outcome))
          .join("\n\n"),
  ].join("\n");
  const result = await sendPostalEmail({
    to: recipient,
    from: sender,
    subject,
    htmlBody: renderAuditMarkdownToHtml(body),
    tag: "alert-remediation",
  });
  return { sent: true, subject, messageId: result.messageId };
}

export const alertRemediationActivities = {
  collectAlertRemediationAlerts: collectAlerts,
  findExistingAlertRemediationPr: findExistingPr,
  prepareAlertRemediationWorkdir: prepareWorkdir,
  runAlertRemediationAgent: runAgent,
  cleanupAlertRemediationWorkdir: cleanup,
  sendAlertRemediationSweepEmail: sendSweepEmail,
};

export type AlertRemediationActivities = typeof alertRemediationActivities;

export function childWorkflowIdForAlert(alert: NormalizedAlert): string {
  return alertRemediationWorkflowId(alert);
}
