import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { z } from "zod";
import { resetConfigurationForTests } from "#src/configuration.ts";

const PutObjectCommandSchema = z.object({
  input: z.object({
    Bucket: z.string(),
    Key: z.string(),
    Body: z.union([z.instanceof(Uint8Array), z.string()]),
    ContentType: z.string(),
    Metadata: z.record(z.string(), z.string()).optional(),
  }),
});

export const s3Mock = mockClient(S3Client);

export function resetS3TestState(): void {
  Bun.env["S3_BUCKET_NAME"] = "test-bucket";
  resetConfigurationForTests();
  s3Mock.reset();
}

export function setS3TestBucket(bucket: string | undefined): void {
  if (bucket === undefined) {
    delete Bun.env["S3_BUCKET_NAME"];
  } else {
    Bun.env["S3_BUCKET_NAME"] = bucket;
  }
  resetConfigurationForTests();
}

export function mockSuccessfulPut(httpStatusCode = 200): void {
  s3Mock.on(PutObjectCommand).resolves({ $metadata: { httpStatusCode } });
}

export function mockFailedPut(message: string): void {
  s3Mock.on(PutObjectCommand).rejects(new Error(message));
}

export function getValidatedPutCommand(callIndex = 0) {
  return PutObjectCommandSchema.parse(s3Mock.call(callIndex).args[0]);
}

export function currentUtcDatePath(now = new Date()): string {
  return [
    now.getUTCFullYear().toString(),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    String(now.getUTCDate()).padStart(2, "0"),
  ].join("/");
}
