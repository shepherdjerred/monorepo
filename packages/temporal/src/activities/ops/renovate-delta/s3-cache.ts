import {
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  RenovateVersionDeltaSchema,
  type RenovateVersionDelta,
} from "@shepherdjerred/ops-model/facets.ts";
import { z } from "zod";

export const RENOVATE_DELTA_ITEMS_PREFIX = "renovate-deltas/v1/items";
export const RENOVATE_DELTA_LATEST_INDEX_KEY =
  "renovate-deltas/v1/latest-index.json";

export const RenovateDeltaIndexSchema = z.object({
  updatedAt: z.iso.datetime(),
  deltasByBranch: z.record(z.string(), RenovateVersionDeltaSchema),
});
export type RenovateDeltaIndex = z.infer<typeof RenovateDeltaIndexSchema>;

export type S3ObjectSender = {
  readonly send: (command: GetObjectCommand | PutObjectCommand) => Promise<{
    readonly Body?:
      { readonly transformToString: () => Promise<string> } | undefined;
  }>;
};

export type RenovateDeltaStore = {
  readonly getItem: (
    cacheKey: string,
  ) => Promise<RenovateVersionDelta | undefined>;
  readonly putItem: (delta: RenovateVersionDelta) => Promise<void>;
  readonly getLatestIndex: () => Promise<RenovateDeltaIndex | undefined>;
  readonly putLatestIndex: (index: RenovateDeltaIndex) => Promise<void>;
};

export function computeDeltaCacheKey(input: {
  readonly packageName: string;
  readonly effectiveFromVersion: string | null;
  readonly targetVersion: string;
  readonly consumers: readonly string[];
}): string {
  const consumersKey = [...new Set(input.consumers)].toSorted().join(",");
  const raw = `${input.packageName}|${input.effectiveFromVersion ?? ""}|${input.targetVersion}|${consumersKey}`;
  return new Bun.CryptoHasher("sha256").update(raw).digest("hex");
}

export function renovateDeltaItemKey(cacheKey: string): string {
  return `${RENOVATE_DELTA_ITEMS_PREFIX}/${cacheKey}.json`;
}

function requiredEnv(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function createSeaweedS3Client(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): { client: S3Client; bucket: string } {
  const sessionToken = env["AWS_SESSION_TOKEN"];
  return {
    client: new S3Client({
      endpoint: requiredEnv("S3_ENDPOINT", env),
      region: env["S3_REGION"] ?? "us-east-1",
      forcePathStyle: (env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
      credentials: {
        accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID", env),
        secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY", env),
        ...(sessionToken === undefined || sessionToken === ""
          ? {}
          : { sessionToken }),
      },
    }),
    bucket: env["REPORT_RECEIPT_BUCKET"] ?? "llm-archive",
  };
}

function isS3NotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

async function readJsonFromS3<T extends z.ZodType>(
  client: S3ObjectSender,
  bucket: string,
  key: string,
  schema: T,
): Promise<z.infer<T> | undefined> {
  try {
    const response = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    if (response.Body === undefined) {
      return undefined;
    }
    const raw = await response.Body.transformToString();
    return schema.parse(JSON.parse(raw));
  } catch (error: unknown) {
    if (isS3NotFound(error)) {
      return undefined;
    }
    throw error;
  }
}

export function createS3RenovateDeltaStore(options?: {
  readonly client?: S3ObjectSender;
  readonly bucket?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): RenovateDeltaStore {
  const configured: { client: S3ObjectSender; bucket: string } =
    options?.client === undefined
      ? createSeaweedS3Client(options?.env ?? Bun.env)
      : {
          client: options.client,
          bucket:
            options.bucket ??
            options.env?.["REPORT_RECEIPT_BUCKET"] ??
            Bun.env["REPORT_RECEIPT_BUCKET"] ??
            "llm-archive",
        };

  return {
    async getItem(cacheKey: string) {
      return await readJsonFromS3(
        configured.client,
        configured.bucket,
        renovateDeltaItemKey(cacheKey),
        RenovateVersionDeltaSchema,
      );
    },
    async putItem(delta: RenovateVersionDelta) {
      const validated = RenovateVersionDeltaSchema.parse(delta);
      await configured.client.send(
        new PutObjectCommand({
          Bucket: configured.bucket,
          Key: renovateDeltaItemKey(validated.cacheKey),
          Body: JSON.stringify(validated),
          ContentType: "application/json",
        }),
      );
    },
    async getLatestIndex() {
      return await readJsonFromS3(
        configured.client,
        configured.bucket,
        RENOVATE_DELTA_LATEST_INDEX_KEY,
        RenovateDeltaIndexSchema,
      );
    },
    async putLatestIndex(index: RenovateDeltaIndex) {
      const validated = RenovateDeltaIndexSchema.parse(index);
      await configured.client.send(
        new PutObjectCommand({
          Bucket: configured.bucket,
          Key: RENOVATE_DELTA_LATEST_INDEX_KEY,
          Body: JSON.stringify(validated),
          ContentType: "application/json",
        }),
      );
    },
  };
}
