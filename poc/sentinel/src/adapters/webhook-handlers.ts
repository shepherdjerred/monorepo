import { createHash } from "node:crypto";
import { enqueueJob } from "@shepherdjerred/sentinel/queue/index.ts";
import { logger } from "@shepherdjerred/sentinel/observability/logger.ts";
import {
  buildPromptBlock,
  getRecord,
  getString,
  extractNestedString,
  parseJsonBody,
} from "./webhook-utils.ts";

const webhookLogger = logger.child({ module: "webhook" });

export type WebhookResult = {
  status: string;
  jobId?: string;
  reason?: string;
  error?: string;
};

export type GitHubEventOptions = {
  data: Record<string, unknown>;
  payload: Record<string, unknown>;
  deliveryId: string | undefined;
  event: string | undefined;
};

export async function handleWorkflowRun(
  workflowRun: Record<string, unknown>,
  deliveryId: string | undefined,
  event: string | undefined,
): Promise<WebhookResult> {
  const conclusion = getString(workflowRun, "conclusion");
  if (conclusion !== "failure") {
    return { status: "ignored", reason: "not a failure" };
  }

  const repo =
    extractNestedString(workflowRun, "repository", "full_name") ?? "unknown";
  const branch = getString(workflowRun, "head_branch") ?? "unknown";
  const workflowName = getString(workflowRun, "name") ?? "unknown";
  const failureUrl = getString(workflowRun, "html_url") ?? "unknown";

  const prompt = buildPromptBlock(
    "A GitHub CI workflow has failed. Investigate the failure and propose a fix.",
    {
      Repository: repo,
      Branch: branch,
      Workflow: workflowName,
      Event: "workflow_run",
      "Failure URL": failureUrl,
    },
  );
  try {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt,
      triggerType: "webhook",
      triggerSource: "github",
      ...(deliveryId == null
        ? {}
        : { deduplicationKey: `github:${deliveryId}` }),
      triggerMetadata: { event, deliveryId, repo, branch, workflowName },
    });
    webhookLogger.info(
      { jobId: job.id, repo, workflowName },
      "GitHub workflow_run failure enqueued",
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue GitHub workflow_run job");
    return { status: "error", error: "enqueue failed" };
  }
}

export async function handleBuildkiteBuild(
  payload: Record<string, unknown>,
  event: string | undefined,
): Promise<WebhookResult> {
  if (event !== "build.finished") {
    return { status: "ignored", reason: "unhandled event" };
  }

  const build = getRecord(payload, "build");
  if (build == null) return { status: "error", error: "missing build" };

  if (getString(build, "state") !== "failed") {
    return { status: "ignored", reason: "not a failure" };
  }

  const branch = getString(build, "branch") ?? "unknown";
  if (branch !== "main") {
    return { status: "ignored", reason: "not main branch" };
  }

  const pipeline = getRecord(payload, "pipeline");
  const pipelineName =
    (pipeline == null ? undefined : getString(pipeline, "name")) ?? "unknown";
  const buildUrl = getString(build, "web_url") ?? "unknown";
  const buildId = getString(build, "id") ?? "unknown";
  const message = getString(build, "message") ?? "unknown";

  const prompt = buildPromptBlock(
    "A Buildkite CI build has failed on main. Investigate the failure and propose a fix.",
    {
      Pipeline: pipelineName,
      Branch: branch,
      "Build URL": buildUrl,
      "Commit message": message,
    },
  );
  try {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt,
      triggerType: "webhook",
      triggerSource: "buildkite",
      deduplicationKey: `buildkite:${buildId}`,
      triggerMetadata: { event, pipelineName, branch, buildUrl, buildId },
    });
    webhookLogger.info(
      { jobId: job.id, pipelineName, buildUrl },
      "Buildkite build failure enqueued",
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue Buildkite job");
    return { status: "error", error: "enqueue failed" };
  }
}

export async function handleCheckSuite(
  options: GitHubEventOptions,
): Promise<WebhookResult> {
  const conclusion = getString(options.data, "conclusion");
  if (conclusion !== "failure") {
    return { status: "ignored", reason: "not a failure" };
  }

  const repo =
    extractNestedString(options.payload, "repository", "full_name") ??
    "unknown";
  const branch = getString(options.data, "head_branch") ?? "unknown";
  const failureUrl = getString(options.data, "url") ?? "unknown";

  const prompt = buildPromptBlock(
    "A GitHub CI workflow has failed. Investigate the failure and propose a fix.",
    {
      Repository: repo,
      Branch: branch,
      Workflow: "check_suite",
      Event: "check_suite",
      "Failure URL": failureUrl,
    },
  );
  try {
    const job = await enqueueJob({
      agent: "ci-fixer",
      prompt,
      triggerType: "webhook",
      triggerSource: "github",
      ...(options.deliveryId == null
        ? {}
        : { deduplicationKey: `github:${options.deliveryId}` }),
      triggerMetadata: {
        event: options.event,
        deliveryId: options.deliveryId,
        repo,
        branch,
      },
    });
    webhookLogger.info(
      { jobId: job.id, repo },
      "GitHub check_suite failure enqueued",
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue GitHub check_suite job");
    return { status: "error", error: "enqueue failed" };
  }
}

export async function handlePagerDutyEvent(
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const event = getRecord(payload, "event");
  if (event == null) return { status: "error", error: "missing event" };

  const eventType = getString(event, "event_type");
  if (eventType !== "incident.triggered") {
    return { status: "ignored", reason: "unhandled event type" };
  }

  const eventId = getString(event, "id");
  const eventData = getRecord(event, "data");
  const title =
    (eventData == null ? undefined : getString(eventData, "title")) ??
    "unknown";
  const urgency =
    (eventData == null ? undefined : getString(eventData, "urgency")) ??
    "unknown";
  const htmlUrl =
    (eventData == null ? undefined : getString(eventData, "html_url")) ??
    "unknown";
  const service =
    eventData == null
      ? undefined
      : extractNestedString(eventData, "service", "summary");

  const prompt = buildPromptBlock(
    "A PagerDuty incident has been triggered. Investigate and triage this alert.",
    {
      Title: title,
      Service: service ?? "unknown",
      Urgency: urgency,
      URL: htmlUrl,
    },
  );

  try {
    const job = await enqueueJob({
      agent: "pd-triager",
      prompt,
      triggerType: "webhook",
      triggerSource: "pagerduty",
      ...(eventId == null ? {} : { deduplicationKey: `pagerduty:${eventId}` }),
      triggerMetadata: { eventType, eventId, title, service, urgency },
    });
    webhookLogger.info(
      { jobId: job.id, title, service },
      "PagerDuty incident enqueued",
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue PagerDuty job");
    return { status: "error", error: "enqueue failed" };
  }
}

export async function handleBugsinkEvent(
  rawBody: string,
): Promise<WebhookResult> {
  const p = parseJsonBody(rawBody);
  if (p == null) return { status: "error", error: "invalid JSON" };

  const bodyHash = createHash("sha256").update(rawBody).digest("hex");
  const title = getString(p, "title") ?? "unknown error";
  const project = getString(p, "project") ?? "unknown";
  const url = getString(p, "url") ?? "unknown";

  const prompt = buildPromptBlock(
    "A new error has been reported in Bugsink. Investigate and triage this error.",
    {
      Title: title,
      Project: project,
      URL: url,
    },
  );
  try {
    const job = await enqueueJob({
      agent: "personal-assistant",
      prompt,
      triggerType: "webhook",
      triggerSource: "bugsink",
      deduplicationKey: `bugsink:${bodyHash}`,
      triggerMetadata: { title, project, url },
    });
    webhookLogger.info(
      { jobId: job.id, title, project },
      "Bugsink error enqueued",
    );
    return { status: "enqueued", jobId: job.id };
  } catch (error: unknown) {
    webhookLogger.error({ error }, "Failed to enqueue Bugsink job");
    return { status: "error", error: "enqueue failed" };
  }
}
