import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import type { z } from "zod/v4";

export type ReportReceiptStore = {
  client: S3Client;
  bucket: string;
  prefix: string;
};

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for report receipt storage`);
  }
  return value;
}

export function reportReceiptStore(): ReportReceiptStore {
  const accessKeyId = requiredEnv("AWS_ACCESS_KEY_ID");
  const secretAccessKey = requiredEnv("AWS_SECRET_ACCESS_KEY");
  const sessionToken = Bun.env["AWS_SESSION_TOKEN"];
  const credentials =
    sessionToken === undefined || sessionToken === ""
      ? { accessKeyId, secretAccessKey }
      : { accessKeyId, secretAccessKey, sessionToken };
  return {
    client: new S3Client({
      endpoint: requiredEnv("S3_ENDPOINT"),
      region: Bun.env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: (Bun.env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      credentials,
    }),
    bucket: Bun.env["REPORT_RECEIPT_BUCKET"] ?? "llm-archive",
    prefix: Bun.env["REPORT_RECEIPT_PREFIX"] ?? "reports/receipts",
  };
}

function isMissingObject(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

export async function readJson<T>(
  store: ReportReceiptStore,
  key: string,
  schema: z.ZodType<T>,
): Promise<{ value: T; etag: string } | undefined> {
  try {
    const response = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: key }),
    );
    if (response.Body === undefined || response.ETag === undefined) {
      throw new Error(`Report object ${key} has no body or entity tag`);
    }
    return {
      value: schema.parse(JSON.parse(await response.Body.transformToString())),
      etag: response.ETag,
    };
  } catch (error: unknown) {
    if (isMissingObject(error)) return undefined;
    throw error;
  }
}

export async function writeJson(
  store: ReportReceiptStore,
  key: string,
  value: unknown,
  condition?: { expectedEtag: string | undefined },
): Promise<void> {
  await store.client.send(
    new PutObjectCommand({
      Bucket: store.bucket,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: "application/json; charset=utf-8",
      ...(condition === undefined
        ? {}
        : condition.expectedEtag === undefined
          ? { IfNoneMatch: "*" }
          : { IfMatch: condition.expectedEtag }),
    }),
  );
}

/**
 * Runs a conditional put, reporting a lost race rather than throwing. 412 is
 * the conditional-write rejection; 409 is what S3 returns when two conditional
 * writes race. Both mean another attempt won, which is a normal outcome here
 * rather than a storage failure.
 */
export async function conditionalWrite(
  write: () => Promise<void>,
): Promise<boolean> {
  try {
    await write();
    return true;
  } catch (error: unknown) {
    if (
      error instanceof S3ServiceException &&
      (error.$metadata.httpStatusCode === 412 ||
        error.$metadata.httpStatusCode === 409)
    ) {
      return false;
    }
    throw error;
  }
}
