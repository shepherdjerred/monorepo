import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

/** Narrowed rather than asserted: the mock hands its fake the input as unknown. */
const PutInputSchema = z.object({
  Key: z.string(),
  Body: z.instanceof(Uint8Array),
});
const GetInputSchema = z.object({ Key: z.string() });

export type S3ObjectStore = {
  /** Key to stored body, decoded. */
  readonly objects: Map<string, string>;
  /** How many puts have been issued. */
  putCount: () => number;
};

/**
 * An in-memory object store: what was PUT is what a later GET returns.
 *
 * `mockSuccessfulPut` acknowledges a put without keeping the body, which is
 * enough for a test that only inspects the request. It is NOT enough for any
 * test about content that is later read BACK — a verified read-back compares
 * the bytes against a recorded digest, so a mock that served something else
 * would fail for the wrong reason, and one that served a fixed body would pass
 * for the wrong reason.
 *
 * `putDelayMs` holds each put open long enough that a rival attempt would
 * start inside it, which is what makes a serialization test meaningful.
 */
export function mockS3ObjectStore(
  options: { putDelayMs?: number } = {},
): S3ObjectStore {
  const objects = new Map<string, string>();
  let puts = 0;
  s3Mock.on(PutObjectCommand).callsFake(async (input: unknown) => {
    puts += 1;
    const put = PutInputSchema.parse(input);
    if (options.putDelayMs !== undefined) {
      await new Promise((done) => setTimeout(done, options.putDelayMs));
    }
    objects.set(put.Key, new TextDecoder().decode(put.Body));
    return { $metadata: { httpStatusCode: 200 } };
  });
  s3Mock.on(GetObjectCommand).callsFake((input: unknown) => {
    const key = GetInputSchema.parse(input).Key;
    const body = objects.get(key);
    if (body === undefined) throw new Error(`no such object: ${key}`);
    return {
      Body: { transformToString: () => Promise.resolve(body) },
      $metadata: {},
    };
  });
  return { objects, putCount: () => puts };
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
