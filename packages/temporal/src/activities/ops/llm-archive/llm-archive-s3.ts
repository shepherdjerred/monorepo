import {
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  ArchiveDateKeySchema,
  type ArchivedSpanIndexRow,
} from "@shepherdjerred/llm-observability/llm-traces";
import type { StructuredLogger } from "#observability/logging.ts";
import { parseArchiveEnvelopeToIndexRow } from "./llm-archive-envelope.ts";

export const DOWNLOAD_CONCURRENCY = 8;

export type S3ListOutput = {
  readonly CommonPrefixes?:
    readonly { readonly Prefix?: string | undefined }[] | undefined;
  readonly Contents?:
    readonly { readonly Key?: string | undefined }[] | undefined;
  readonly IsTruncated?: boolean | undefined;
  readonly NextContinuationToken?: string | undefined;
};

export type S3GetOutput = {
  readonly Body?:
    { readonly transformToByteArray: () => Promise<Uint8Array> } | undefined;
};

export type LlmArchiveS3Sender = {
  readonly send: (
    command: ListObjectsV2Command | GetObjectCommand,
  ) => Promise<S3ListOutput & S3GetOutput>;
};

export type ProviderTarget = {
  service: string;
  provider: string;
  watermarkPrefix: string;
};

function requiredS3Env(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for llm-archive-index`);
  }
  return value;
}

export function createS3Sender(
  env: Readonly<Record<string, string | undefined>>,
): LlmArchiveS3Sender {
  const sessionToken = env["AWS_SESSION_TOKEN"]?.trim();
  const regionRaw = env["S3_REGION"]?.trim();
  const region =
    regionRaw === undefined || regionRaw === "" ? "us-east-1" : regionRaw;
  const client = new S3Client({
    endpoint: requiredS3Env("S3_ENDPOINT", env),
    region,
    forcePathStyle: (env["S3_FORCE_PATH_STYLE"] ?? "true") === "true",
    credentials: {
      accessKeyId: requiredS3Env("AWS_ACCESS_KEY_ID", env),
      secretAccessKey: requiredS3Env("AWS_SECRET_ACCESS_KEY", env),
      ...(sessionToken === undefined || sessionToken === ""
        ? {}
        : { sessionToken }),
    },
  });
  return {
    send: async (command) =>
      command instanceof ListObjectsV2Command
        ? await client.send(command)
        : await client.send(command),
  };
}

function isS3NotFound(error: unknown): boolean {
  return (
    error instanceof NoSuchKey ||
    (error instanceof S3ServiceException &&
      error.$metadata.httpStatusCode === 404)
  );
}

async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: (R | undefined)[] = Array.from({ length: items.length });
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      const item = items[current];
      if (item !== undefined) {
        results[current] = await mapper(item);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.flatMap((entry) => (entry === undefined ? [] : [entry]));
}

async function listCommonPrefixes(
  s3: LlmArchiveS3Sender,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const prefixes: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: "/",
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    for (const entry of page.CommonPrefixes ?? []) {
      if (entry.Prefix !== undefined) {
        prefixes.push(entry.Prefix);
      }
    }
    continuationToken =
      page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);
  return prefixes.toSorted();
}

function trailingSegment(parentPrefix: string, childPrefix: string): string {
  const stripped = childPrefix.startsWith(parentPrefix)
    ? childPrefix.slice(parentPrefix.length)
    : childPrefix;
  return stripped.replaceAll(/\/+$/gu, "");
}

export async function enumerateProviderTargets(
  s3: LlmArchiveS3Sender,
  bucket: string,
  s3Prefix: string,
): Promise<ProviderTarget[]> {
  const targets: ProviderTarget[] = [];
  const rootPrefix = `${s3Prefix}/`;
  const servicePrefixes = await listCommonPrefixes(s3, bucket, rootPrefix);
  for (const servicePrefix of servicePrefixes) {
    const service = trailingSegment(rootPrefix, servicePrefix);
    if (service === "" || service.includes("/")) continue;
    const providerPrefixes = await listCommonPrefixes(
      s3,
      bucket,
      servicePrefix,
    );
    for (const providerPrefix of providerPrefixes) {
      const provider = trailingSegment(servicePrefix, providerPrefix);
      if (provider === "" || provider.includes("/")) continue;
      targets.push({
        service,
        provider,
        watermarkPrefix: `${s3Prefix}/${service}/${provider}`,
      });
    }
  }
  return targets.toSorted((a, b) =>
    a.watermarkPrefix.localeCompare(b.watermarkPrefix),
  );
}

async function enumerateDaysInMonth(input: {
  s3: LlmArchiveS3Sender;
  bucket: string;
  monthPrefix: string;
  yearMonth: string;
  startDateKey: string;
}): Promise<string[]> {
  const dayPrefixes = await listCommonPrefixes(
    input.s3,
    input.bucket,
    input.monthPrefix,
  );
  const days: string[] = [];
  for (const dayPrefix of dayPrefixes) {
    const dd = trailingSegment(input.monthPrefix, dayPrefix);
    const dateKey = `${input.yearMonth}/${dd}`;
    if (
      /^\d{2}$/u.test(dd) &&
      dateKey >= input.startDateKey &&
      ArchiveDateKeySchema.safeParse(dateKey).success
    ) {
      days.push(dateKey);
    }
  }
  return days;
}

export async function enumerateDateKeys(
  s3: LlmArchiveS3Sender,
  bucket: string,
  watermarkPrefix: string,
  startDateKey: string,
): Promise<string[]> {
  const startYear = startDateKey.slice(0, 4);
  const startYearMonth = startDateKey.slice(0, 7);
  const dateKeys: string[] = [];
  const yearParent = `${watermarkPrefix}/`;
  const yearPrefixes = await listCommonPrefixes(s3, bucket, yearParent);

  for (const yearPrefix of yearPrefixes) {
    const yyyy = trailingSegment(yearParent, yearPrefix);
    if (!/^\d{4}$/u.test(yyyy) || yyyy < startYear) continue;
    const monthPrefixes = await listCommonPrefixes(s3, bucket, yearPrefix);
    for (const monthPrefix of monthPrefixes) {
      const mm = trailingSegment(yearPrefix, monthPrefix);
      const yearMonth = `${yyyy}/${mm}`;
      if (!/^\d{2}$/u.test(mm) || yearMonth < startYearMonth) continue;
      const monthDays = await enumerateDaysInMonth({
        s3,
        bucket,
        monthPrefix,
        yearMonth,
        startDateKey,
      });
      dateKeys.push(...monthDays);
    }
  }

  return dateKeys.toSorted();
}

function extractJsonGzKeys(page: S3ListOutput): string[] {
  return (page.Contents ?? [])
    .flatMap((item) =>
      item.Key?.endsWith(".json.gz") === true ? [item.Key] : [],
    )
    .toSorted();
}

function appendBoundedKeys(
  target: string[],
  incoming: readonly string[],
  limit: number,
): boolean {
  for (const key of incoming) {
    if (target.length >= limit) return false;
    target.push(key);
  }
  return true;
}

export async function listDayArchiveKeys(input: {
  s3: LlmArchiveS3Sender;
  bucket: string;
  dayPrefix: string;
  limit: number;
  startAfterKey?: string | undefined;
}): Promise<{ keys: string[]; dayCompleted: boolean }> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  let startAfter = input.startAfterKey;

  do {
    const page = await input.s3.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: input.dayPrefix,
        ...(startAfter === undefined ? {} : { StartAfter: startAfter }),
        ...(continuationToken === undefined
          ? {}
          : { ContinuationToken: continuationToken }),
      }),
    );
    startAfter = undefined;

    const fitAll = appendBoundedKeys(
      keys,
      extractJsonGzKeys(page),
      input.limit,
    );
    if (!fitAll || (page.IsTruncated === true && keys.length >= input.limit)) {
      return { keys, dayCompleted: false };
    }
    continuationToken =
      page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);

  return { keys, dayCompleted: true };
}

export async function downloadAndParseArchiveWindow(input: {
  s3: LlmArchiveS3Sender;
  bucket: string;
  keys: readonly string[];
  target: ProviderTarget;
  logger: StructuredLogger;
}): Promise<ArchivedSpanIndexRow[]> {
  const rows = await mapWithBoundedConcurrency(
    input.keys,
    DOWNLOAD_CONCURRENCY,
    async (s3Key): Promise<ArchivedSpanIndexRow | null> => {
      try {
        const obj = await input.s3.send(
          new GetObjectCommand({ Bucket: input.bucket, Key: s3Key }),
        );
        if (obj.Body === undefined) {
          input.logger("warning", "Skipping empty llm-archive S3 body", {
            s3Key,
          });
          return null;
        }
        const compressedBytes = await obj.Body.transformToByteArray();
        return parseArchiveEnvelopeToIndexRow({
          s3Key,
          compressedBytes,
          fallbackService: input.target.service,
          fallbackProvider: input.target.provider,
          logger: input.logger,
        });
      } catch (error: unknown) {
        if (isS3NotFound(error)) {
          input.logger(
            "warning",
            "Skipping vanished llm-archive S3 object during scan",
            { s3Key },
          );
          return null;
        }
        throw error;
      }
    },
  );
  return rows.flatMap((row) => (row === null ? [] : [row]));
}
