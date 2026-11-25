import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";

const SHA256_HEX_SCHEMA = z.string().regex(/^[a-f0-9]{64}$/u);

export const GitBackupLatestManifestSchema = z.object({
  schemaVersion: z.literal(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  refDigest: SHA256_HEX_SCHEMA,
  refCount: z.number().int().nonnegative(),
  snapshotId: z.string().min(1),
  bundleKey: z.string().min(1).nullable(),
  lfsDigest: SHA256_HEX_SCHEMA.nullable().default(null),
  lfsKey: z.string().min(1).nullable().default(null),
  lfsObjectCount: z.number().int().nonnegative().default(0),
  wikiRefDigest: SHA256_HEX_SCHEMA.nullable().default(null),
  wikiRefCount: z.number().int().nonnegative().default(0),
  wikiBundleKey: z.string().min(1).nullable().default(null),
  issuesKey: z.string().min(1),
  issuesDigest: SHA256_HEX_SCHEMA.nullable().default(null),
  issueCount: z.number().int().nonnegative(),
  wikiStatus: z.enum(["mirrored", "uninitialized", "disabled"]),
  updatedAt: z.iso.datetime({ offset: true }),
});

export type GitBackupLatestManifest = z.infer<
  typeof GitBackupLatestManifestSchema
>;

export type GitBackupObjectStore = {
  readonly readLatest: (
    owner: string,
    repo: string,
  ) => Promise<GitBackupLatestManifest | undefined>;
  readonly writeLatest: (manifest: GitBackupLatestManifest) => Promise<void>;
  readonly putFile: (
    key: string,
    filePath: string,
    contentType: string,
  ) => Promise<void>;
  readonly putBytes: (
    key: string,
    body: Uint8Array,
    contentType: string,
  ) => Promise<void>;
  readonly listKeys: (prefix: string) => Promise<string[]>;
  readonly deleteKeys: (keys: readonly string[]) => Promise<void>;
};

export function latestManifestKey(owner: string, repo: string): string {
  return `${owner}/${repo}/latest.json`;
}

export function snapshotObjectKeys(
  owner: string,
  repo: string,
  snapshotId: string,
): {
  prefix: string;
  bundleKey: string;
  lfsKey: string;
  wikiBundleKey: string;
  issuesKey: string;
} {
  const prefix = `${owner}/${repo}/snapshots/`;
  return {
    prefix,
    bundleKey: `${prefix}${snapshotId}.bundle.zst`,
    lfsKey: `${prefix}${snapshotId}.lfs.tar.zst`,
    wikiBundleKey: `${prefix}${snapshotId}.wiki.bundle.zst`,
    issuesKey: `${prefix}${snapshotId}.issues.json.zst`,
  };
}

const SNAPSHOT_FILE_RE =
  /\/snapshots\/(?<snapshotId>\d{4}-\d{2}-\d{2}(?:T\d{6}Z)?-[a-f0-9]{12})\.(?:bundle|wiki\.bundle|lfs\.tar|issues\.json)\.zst$/u;

function groupKeysBySnapshot(keys: readonly string[]): Map<string, string[]> {
  const keysBySnapshot = new Map<string, string[]>();
  for (const key of keys) {
    const match = SNAPSHOT_FILE_RE.exec(key);
    const snapshotId = match?.groups?.["snapshotId"];
    if (snapshotId === undefined) {
      continue;
    }
    const existing = keysBySnapshot.get(snapshotId) ?? [];
    existing.push(key);
    keysBySnapshot.set(snapshotId, existing);
  }
  return keysBySnapshot;
}

export function selectSnapshotKeysToPrune(input: {
  readonly keys: readonly string[];
  readonly keep: number;
  readonly currentSnapshotId: string;
  readonly protectedKeys?: readonly (string | null | undefined)[] | undefined;
}): string[] {
  const keysBySnapshot = groupKeysBySnapshot(input.keys);
  const orderedSnapshotIds = [...keysBySnapshot.keys()].toSorted(
    (left, right) => right.localeCompare(left),
  );
  const retained = new Set<string>([input.currentSnapshotId]);
  for (const snapshotId of orderedSnapshotIds) {
    if (retained.size >= input.keep) {
      break;
    }
    retained.add(snapshotId);
  }

  const protectedSet = new Set(
    (input.protectedKeys ?? []).flatMap((key) =>
      typeof key === "string" && key !== "" ? [key] : [],
    ),
  );

  const keysToDelete: string[] = [];
  for (const [snapshotId, snapshotKeys] of keysBySnapshot) {
    if (retained.has(snapshotId)) {
      continue;
    }
    for (const key of snapshotKeys) {
      if (!protectedSet.has(key)) {
        keysToDelete.push(key);
      }
    }
  }
  return keysToDelete.toSorted();
}

export function assertNoDeleteObjectsErrors(
  errors:
    | readonly {
        readonly Key?: string | undefined;
        readonly Code?: string | undefined;
        readonly Message?: string | undefined;
      }[]
    | undefined,
): void {
  if (errors === undefined || errors.length === 0) {
    return;
  }
  const summary = errors
    .slice(0, 5)
    .map(
      (entry) =>
        `${entry.Key ?? "<unknown>"} (${entry.Code ?? "Error"}: ${entry.Message ?? "delete failed"})`,
    )
    .join("; ");
  throw new Error(
    `Failed to delete ${String(errors.length)} Git backup snapshot object(s): ${summary}`,
  );
}

function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is required for Git backup S3 storage`);
  }
  return value;
}

const ErrorNameSchema = z.object({ name: z.string().optional() });

function isMissingObjectError(error: unknown): boolean {
  if (error instanceof NoSuchKey || error instanceof NotFound) {
    return true;
  }
  const parsed = ErrorNameSchema.safeParse(error);
  return (
    parsed.success &&
    (parsed.data.name === "NoSuchKey" || parsed.data.name === "NotFound")
  );
}

export function createS3GitBackupStore(
  env: Readonly<Record<string, string | undefined>> = Bun.env,
): GitBackupObjectStore {
  const bucket = requiredEnv(env, "GIT_BACKUP_S3_BUCKET");
  const client = new S3Client({
    endpoint: requiredEnv(env, "S3_ENDPOINT"),
    region: env["S3_REGION"] ?? env["AWS_REGION"] ?? "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: requiredEnv(env, "AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env, "AWS_SECRET_ACCESS_KEY"),
    },
  });

  return {
    async readLatest(owner, repo) {
      const key = latestManifestKey(owner, repo);
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
        );
        if (response.Body === undefined) {
          return;
        }
        const text = await response.Body.transformToString("utf8");
        return GitBackupLatestManifestSchema.parse(JSON.parse(text));
      } catch (error: unknown) {
        if (isMissingObjectError(error)) {
          return;
        }
        throw error;
      }
    },

    async writeLatest(manifest) {
      const validated = GitBackupLatestManifestSchema.parse(manifest);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: latestManifestKey(validated.owner, validated.repo),
          Body: JSON.stringify(validated, null, 2),
          ContentType: "application/json; charset=utf-8",
        }),
      );
    },

    async putFile(key, filePath, contentType) {
      const bytes = await Bun.file(filePath).bytes();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: contentType,
        }),
      );
    },

    async putBytes(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: body.byteLength,
          ContentType: contentType,
        }),
      );
    },

    async listKeys(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const response = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ...(continuationToken === undefined
              ? {}
              : { ContinuationToken: continuationToken }),
          }),
        );
        for (const item of response.Contents ?? []) {
          if (item.Key !== undefined) {
            keys.push(item.Key);
          }
        }
        continuationToken =
          response.IsTruncated === true
            ? response.NextContinuationToken
            : undefined;
      } while (continuationToken !== undefined);
      return keys;
    },

    async deleteKeys(keys) {
      for (let offset = 0; offset < keys.length; offset += 1000) {
        const chunk = keys.slice(offset, offset + 1000);
        const response = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: chunk.map((objectKey) => ({ Key: objectKey })),
              Quiet: true,
            },
          }),
        );
        assertNoDeleteObjectsErrors(response.Errors);
      }
    },
  };
}
