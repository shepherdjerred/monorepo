import { Context } from "@temporalio/activity";
import { workflowExecutionContext } from "#activities/temporal-context.ts";
import { renderAuditMarkdownToHtml } from "#shared/markdown-to-html.ts";
import { putS3Object, type S3PutObjectConfig } from "#shared/s3.ts";
import type {
  HomelabAuditAgentResult,
  HomelabAuditEmailResult,
} from "./homelab-audit.ts";

export type HomelabAuditArchiveBodyInput = {
  date: string;
  markdown: string;
};

export type HomelabAuditArchiveBodyResult = {
  markdownKey: string;
  htmlKey: string;
  uploadedAt: string;
};

export type HomelabAuditArchiveMetadataInput = {
  date: string;
  bodyArchive: HomelabAuditArchiveBodyResult;
  email: HomelabAuditEmailResult;
  agent: HomelabAuditAgentResult;
};

export type HomelabAuditArchiveMetadataResult = {
  metadataKey: string;
  uploadedAt: string;
};

type AuditArchiveConfig = {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
};

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

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function loadAuditArchiveConfig(): AuditArchiveConfig {
  return {
    bucket: requiredEnv("HOMELAB_AUDIT_ARCHIVE_BUCKET"),
    accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY"),
    sessionToken: Bun.env["AWS_SESSION_TOKEN"],
    endpoint: requiredEnv("S3_ENDPOINT"),
    region: Bun.env["S3_REGION"] ?? "us-east-1",
    forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
  };
}

function archiveKeyPrefix(date: string): string {
  const context = activityInfoOrUndefined();
  const workflowId =
    typeof context?.["workflowId"] === "string"
      ? context["workflowId"]
      : `manual-${date}`;
  const runId =
    typeof context?.["runId"] === "string" ? context["runId"] : "local";
  const safeWorkflowId = workflowId.replaceAll(/[^\w.=-]+/g, "-");
  const safeRunId = runId.replaceAll(/[^\w.=-]+/g, "-");
  const [year = "unknown", month = "unknown", day = "unknown"] =
    date.split("-");
  const prefix = Bun.env["HOMELAB_AUDIT_ARCHIVE_PREFIX"] ?? "homelab-audits";
  return `${prefix}/${year}/${month}/${day}/${safeWorkflowId}/${safeRunId}`;
}

async function putAuditArchiveObject(
  config: AuditArchiveConfig,
  key: string,
  body: string,
  contentType: string,
): Promise<void> {
  const putConfig: S3PutObjectConfig = {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    sessionToken: config.sessionToken,
    endpoint: config.endpoint,
    bucket: config.bucket,
    key,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    contentType,
  };
  await putS3Object(putConfig, body);
}

export async function archiveAuditBody(
  input: HomelabAuditArchiveBodyInput,
): Promise<HomelabAuditArchiveBodyResult> {
  const config = loadAuditArchiveConfig();
  const keyPrefix = archiveKeyPrefix(input.date);
  const markdownKey = `${keyPrefix}/audit.md`;
  const htmlKey = `${keyPrefix}/audit.html`;
  const htmlBody = renderAuditMarkdownToHtml(input.markdown);

  await Promise.all([
    putAuditArchiveObject(
      config,
      markdownKey,
      input.markdown,
      "text/markdown; charset=utf-8",
    ),
    putAuditArchiveObject(
      config,
      htmlKey,
      htmlBody,
      "text/html; charset=utf-8",
    ),
  ]);

  return { markdownKey, htmlKey, uploadedAt: new Date().toISOString() };
}

export async function archiveAuditMetadata(
  input: HomelabAuditArchiveMetadataInput,
): Promise<HomelabAuditArchiveMetadataResult> {
  const config = loadAuditArchiveConfig();
  const metadataKey = `${archiveKeyPrefix(input.date)}/metadata.json`;
  const uploadedAt = new Date().toISOString();
  const context = activityInfoOrUndefined() ?? {};
  const body = JSON.stringify(
    {
      date: input.date,
      uploadedAt,
      workflow: {
        workflowId: context["workflowId"],
        runId: context["runId"],
      },
      archive: input.bodyArchive,
      email: input.email,
      agent: {
        model: input.agent.model,
        durationMs: input.agent.durationMs,
        numTurns: input.agent.numTurns,
        totalCostUsd: input.agent.totalCostUsd,
      },
    },
    null,
    2,
  );

  await putAuditArchiveObject(
    config,
    metadataKey,
    body,
    "application/json; charset=utf-8",
  );

  return { metadataKey, uploadedAt };
}
