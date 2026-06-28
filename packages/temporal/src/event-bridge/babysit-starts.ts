/**
 * Routes an authorized babysitter comment command to Temporal: start (a per-PR
 * `signalWithStart`), stop / status (signal / query the live run), or a plain
 * authorized reply forwarded as `guidance` only while the loop is awaiting it.
 * Also acks the triggering comment with a 👍 and keeps the single status
 * comment current. The webhook handler owns parsing + authz + filters; this owns
 * everything that touches Temporal or GitHub.
 */
import * as Sentry from "@sentry/bun";
import { z } from "zod/v4";
import type { Client } from "@temporalio/client";
import {
  WorkflowIdConflictPolicy,
  WorkflowIdReusePolicy,
} from "@temporalio/common";
import { Octokit } from "octokit";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { createGitHubAppInstallationToken } from "#lib/github-app-token.ts";
import { prBabysitWorkflowId } from "#shared/pr-babysit/workflow-id.ts";
import { PrBabysitInputSchema } from "#shared/pr-babysit/types.ts";
import {
  BABYSIT_SIGNALS,
  BABYSIT_STATUS_QUERY,
  type BabysitStatus,
  type PrBabysitWorkflowInput,
} from "#shared/pr-babysit/workflow-types.ts";
import { postBabysitStatus } from "#activities/pr-babysit/comment.ts";
import { prBabysitCommandsTotal } from "#observability/metrics.ts";
import type { BabysitCommand } from "./babysit-command.ts";
import { jsonLog } from "./webhook-log.ts";

const COMPONENT = "pr-webhook";

export type BabysitRouteInput = {
  owner: string;
  repo: string;
  prNumber: number;
  commentId: number;
  requestedBy: string;
  body: string;
  command: BabysitCommand;
};

export type BabysitRouteFn = (input: BabysitRouteInput) => Promise<void>;

function isNotFound(error: unknown): boolean {
  return error instanceof Error && /not\s*found|NOT_FOUND/i.test(error.message);
}

async function ack(
  octokit: Octokit,
  input: BabysitRouteInput,
  content: "+1" | "confused",
): Promise<void> {
  try {
    await octokit.rest.reactions.createForIssueComment({
      owner: input.owner,
      repo: input.repo,
      comment_id: input.commentId,
      content,
    });
  } catch (error: unknown) {
    jsonLog("warning", "Failed to react to babysit command", {
      commentId: input.commentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const PullSchema = z.object({
  state: z.string(),
  head: z.object({
    ref: z.string(),
    repo: z.object({ owner: z.object({ login: z.string() }) }).nullable(),
  }),
  base: z.object({ ref: z.string() }),
});

async function startBabysit(
  client: Client,
  octokit: Octokit,
  input: BabysitRouteInput,
  command: Extract<BabysitCommand, { kind: "start" }>,
): Promise<void> {
  const pr = await octokit.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
  });
  const parsed = PullSchema.parse(pr.data);
  if (parsed.state !== "open") {
    await ack(octokit, input, "confused");
    prBabysitCommandsTotal.inc({ command: "start", outcome: "ignored" });
    return;
  }
  const headRepoOwner = parsed.head.repo?.owner.login;
  if (headRepoOwner !== input.owner) {
    await postBabysitStatus({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      body: "**PR babysitter** — this PR's head branch is in a fork; the babysitter only supports same-repo branches.",
    });
    prBabysitCommandsTotal.inc({ command: "start", outcome: "ignored" });
    return;
  }

  const workflowInput: PrBabysitWorkflowInput = {
    ...PrBabysitInputSchema.parse({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      headRef: parsed.head.ref,
      baseRef: parsed.base.ref,
      ...(command.instruction === undefined
        ? {}
        : { goal: command.instruction }),
    }),
    requestedBy: input.requestedBy,
  };
  const wallClockMs = (workflowInput.budget.maxWallClockMinutes + 60) * 60_000;

  await client.workflow.signalWithStart("prBabysitWorkflow", {
    taskQueue: TASK_QUEUES.PR_BABYSIT,
    workflowId: prBabysitWorkflowId(input.owner, input.repo, input.prNumber),
    workflowIdReusePolicy: WorkflowIdReusePolicy.ALLOW_DUPLICATE,
    workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
    workflowExecutionTimeout: wallClockMs,
    args: [workflowInput],
    signal: BABYSIT_SIGNALS.reviewActivity,
    signalArgs: [{ kind: "start-command", author: input.requestedBy }],
  });
  await ack(octokit, input, "+1");
  prBabysitCommandsTotal.inc({ command: "start", outcome: "accepted" });
  jsonLog("info", "Babysitter started/reaffirmed", {
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    requestedBy: input.requestedBy,
  });
}

async function stopBabysit(
  client: Client,
  octokit: Octokit,
  input: BabysitRouteInput,
  command: Extract<BabysitCommand, { kind: "stop" }>,
): Promise<void> {
  const handle = client.workflow.getHandle(
    prBabysitWorkflowId(input.owner, input.repo, input.prNumber),
  );
  try {
    await handle.signal(BABYSIT_SIGNALS.stop, {
      reason: `stopped by ${input.requestedBy}`,
    });
    if (command.force) {
      await handle.cancel();
    }
    await ack(octokit, input, "+1");
    prBabysitCommandsTotal.inc({ command: "stop", outcome: "accepted" });
  } catch (error: unknown) {
    if (isNotFound(error)) {
      await ack(octokit, input, "confused");
      prBabysitCommandsTotal.inc({ command: "stop", outcome: "no_workflow" });
      return;
    }
    throw error;
  }
}

async function statusBabysit(
  client: Client,
  octokit: Octokit,
  input: BabysitRouteInput,
): Promise<void> {
  const handle = client.workflow.getHandle(
    prBabysitWorkflowId(input.owner, input.repo, input.prNumber),
  );
  try {
    const status = await handle.query<BabysitStatus>(BABYSIT_STATUS_QUERY);
    await postBabysitStatus({
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
      body: `**PR babysitter** — phase: \`${status.phase}\`, iterations: ${String(status.iterationsTotal)}, cost: $${status.costUsd.toFixed(2)}.`,
    });
    await ack(octokit, input, "+1");
    prBabysitCommandsTotal.inc({ command: "status", outcome: "accepted" });
  } catch (error: unknown) {
    if (isNotFound(error)) {
      await ack(octokit, input, "confused");
      prBabysitCommandsTotal.inc({ command: "status", outcome: "no_workflow" });
      return;
    }
    throw error;
  }
}

async function maybeGuidance(
  client: Client,
  input: BabysitRouteInput,
): Promise<void> {
  const handle = client.workflow.getHandle(
    prBabysitWorkflowId(input.owner, input.repo, input.prNumber),
  );
  try {
    const status = await handle.query<BabysitStatus>(BABYSIT_STATUS_QUERY);
    if (status.phase !== "awaiting-guidance") {
      prBabysitCommandsTotal.inc({ command: "guidance", outcome: "ignored" });
      return;
    }
    await handle.signal(BABYSIT_SIGNALS.guidance, {
      text: input.body,
      requestedBy: input.requestedBy,
      commentId: input.commentId,
    });
    prBabysitCommandsTotal.inc({ command: "guidance", outcome: "accepted" });
  } catch (error: unknown) {
    if (isNotFound(error)) {
      prBabysitCommandsTotal.inc({
        command: "guidance",
        outcome: "no_workflow",
      });
      return;
    }
    throw error;
  }
}

export function createBabysitRoute(client: Client): BabysitRouteFn {
  return async (input) => {
    try {
      const { token } = await createGitHubAppInstallationToken();
      const octokit = new Octokit({ auth: token });
      switch (input.command.kind) {
        case "start":
          await startBabysit(client, octokit, input, input.command);
          return;
        case "stop":
          await stopBabysit(client, octokit, input, input.command);
          return;
        case "status":
          await statusBabysit(client, octokit, input);
          return;
        case "none":
          await maybeGuidance(client, input);
          return;
      }
    } catch (error: unknown) {
      prBabysitCommandsTotal.inc({
        command: input.command.kind,
        outcome: "error",
      });
      Sentry.withScope((scope) => {
        scope.setTag("component", COMPONENT);
        scope.setContext("babysit-route", {
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          command: input.command.kind,
        });
        Sentry.captureException(error);
      });
      jsonLog("error", "Failed to route babysit command", {
        owner: input.owner,
        repo: input.repo,
        prNumber: input.prNumber,
        command: input.command.kind,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
