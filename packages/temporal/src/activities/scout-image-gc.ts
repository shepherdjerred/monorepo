import { Context } from "@temporalio/activity";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod/v4";

// Scout writes generated match/prematch images (.png + .svg) into date-partitioned
// folders alongside the raw JSON it wants to keep forever. Native S3 lifecycle can
// only filter by prefix (not suffix), so this activity prunes the images by suffix +
// age instead. See packages/docs/plans/2026-07-03_scout-s3-image-retention.md.
//
// Objects are write-once, so LastModified ≈ the date embedded in the key — a 30-day
// age filter yields an accurate rolling ~1-month image window.
const BUCKETS = ["scout-prod", "scout-beta"] as const;
const PREFIXES = ["games/", "prematch/"] as const;
const IMAGE_SUFFIXES = [".png", ".svg"] as const;

// S3 DeleteObjects accepts at most 1000 keys per request.
const DELETE_BATCH_SIZE = 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The marketing-showcase manifest references specific report/loading-screen
// images that the scout-showcase-refresh-weekly job re-reads indefinitely —
// pruning them breaks the refresh permanently (rare queue types may never
// produce a replacement; learned 2026-07-19 when a month of GC had eaten 60%
// of the manifest's sources). Fetch the manifest from main and exempt every
// referenced key. Scoped to scout-prod — the manifest is curated against prod.
const SHOWCASE_MANIFEST_URL =
  "https://raw.githubusercontent.com/shepherdjerred/monorepo/main/packages/scout-for-lol/showcase/marketing-showcase.manifest.json";
const SHOWCASE_EXEMPT_BUCKET = "scout-prod";

const ShowcaseManifestKeysSchema = z.object({
  entries: z.array(
    z.looseObject({
      imageKey: z.string().optional(),
      dataKey: z.string().optional(),
    }),
  ),
});

/**
 * Fetch the showcase manifest and return every S3 key it references. Fails
 * loudly (activity failure → Temporal retry) rather than pruning without the
 * exemption list — a GC run that can't see the manifest must not delete.
 */
export async function fetchShowcaseExemptKeys(
  url: string = SHOWCASE_MANIFEST_URL,
): Promise<Set<string>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `[scout-image-gc] failed to fetch showcase manifest (${String(response.status)}) — refusing to prune without the exemption list`,
    );
  }
  const manifest = ShowcaseManifestKeysSchema.parse(await response.json());
  const keys = new Set<string>();
  for (const entry of manifest.entries) {
    if (entry.imageKey !== undefined) keys.add(entry.imageKey);
    if (entry.dataKey !== undefined) keys.add(entry.dataKey);
  }
  return keys;
}

const InputSchema = z.object({
  retentionDays: z.number().int().positive().default(30),
  // When true, list + count what WOULD be deleted but issue no DeleteObjects
  // calls. Used to eyeball the first run before letting it delete for real.
  dryRun: z.boolean().default(false),
});
export type ScoutImageGcInput = z.input<typeof InputSchema>;

export type BucketPruneResult = {
  bucket: string;
  scanned: number;
  matched: number;
  deleted: number;
  bytesReclaimed: number;
};

export type ScoutImageGcResult = {
  dryRun: boolean;
  retentionDays: number;
  cutoff: string;
  buckets: BucketPruneResult[];
  totalMatched: number;
  totalDeleted: number;
  totalBytesReclaimed: number;
};

/**
 * Pure predicate: is this object a Scout-generated image older than the cutoff?
 * Extracted so the suffix + age boundary logic is unit-testable without S3.
 */
export function isPrunableImage(
  key: string,
  lastModified: Date | undefined,
  cutoff: Date,
  options?: {
    suffixes?: readonly string[];
    exemptKeys?: ReadonlySet<string>;
  },
): boolean {
  const suffixes = options?.suffixes ?? IMAGE_SUFFIXES;
  const exemptKeys = options?.exemptKeys ?? new Set<string>();
  if (exemptKeys.has(key)) {
    return false;
  }
  if (lastModified === undefined) {
    return false;
  }
  if (!suffixes.some((suffix) => key.endsWith(suffix))) {
    return false;
  }
  // Strictly older than the cutoff — an object written exactly at the boundary
  // is inside the retention window and kept.
  return lastModified.getTime() < cutoff.getTime();
}

function createScoutS3Client(): S3Client {
  const endpoint = Bun.env["S3_ENDPOINT"] ?? Bun.env["AWS_ENDPOINT_URL"];
  const accessKeyId = Bun.env["AWS_ACCESS_KEY_ID"];
  const secretAccessKey = Bun.env["AWS_SECRET_ACCESS_KEY"];

  if (endpoint === undefined || endpoint === "") {
    throw new Error(
      "S3_ENDPOINT (or AWS_ENDPOINT_URL) is required for Scout image GC",
    );
  }
  if (
    accessKeyId === undefined ||
    accessKeyId === "" ||
    secretAccessKey === undefined ||
    secretAccessKey === ""
  ) {
    throw new Error(
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are required for Scout image GC",
    );
  }

  return new S3Client({
    endpoint,
    region: Bun.env["AWS_REGION"] ?? Bun.env["S3_REGION"] ?? "us-east-1",
    // Path-style addressing — required for SeaweedFS (see scout backend's s3-client.ts).
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function deleteBatch(
  client: S3Client,
  bucket: string,
  keys: { Key: string }[],
): Promise<void> {
  const response = await client.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: keys, Quiet: true },
    }),
  );
  const errors = response.Errors ?? [];
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `[scout-image-gc] ${bucket}: ${String(errors.length)} delete error(s); first: ${first?.Key ?? "?"} — ${first?.Code ?? "?"} ${first?.Message ?? ""}`,
    );
  }
}

type PruneContext = {
  client: S3Client;
  bucket: string;
  cutoff: Date;
  dryRun: boolean;
  exemptKeys: ReadonlySet<string>;
};

async function prunePrefix(
  ctx: PruneContext,
  prefix: string,
): Promise<BucketPruneResult> {
  const { client, bucket, cutoff, dryRun, exemptKeys } = ctx;
  let scanned = 0;
  let matched = 0;
  let deleted = 0;
  let bytesReclaimed = 0;
  let pending: { Key: string }[] = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) {
      return;
    }
    if (!dryRun) {
      await deleteBatch(client, bucket, pending);
      deleted += pending.length;
    }
    pending = [];
  };

  let continuationToken: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    // Heartbeat once per page so a worker death surfaces within heartbeatTimeout
    // rather than burning the whole startToCloseTimeout on the initial sweep.
    Context.current().heartbeat({ bucket, prefix, scanned });

    for (const object of page.Contents ?? []) {
      scanned += 1;
      const key = object.Key;
      if (
        key !== undefined &&
        isPrunableImage(key, object.LastModified, cutoff, { exemptKeys })
      ) {
        matched += 1;
        bytesReclaimed += object.Size ?? 0;
        pending.push({ Key: key });
        if (pending.length >= DELETE_BATCH_SIZE) {
          await flush();
        }
      }
    }

    continuationToken =
      page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);

  await flush();
  return { bucket, scanned, matched, deleted, bytesReclaimed };
}

async function pruneBucket(ctx: PruneContext): Promise<BucketPruneResult> {
  const total: BucketPruneResult = {
    bucket: ctx.bucket,
    scanned: 0,
    matched: 0,
    deleted: 0,
    bytesReclaimed: 0,
  };
  for (const prefix of PREFIXES) {
    const part = await prunePrefix(ctx, prefix);
    total.scanned += part.scanned;
    total.matched += part.matched;
    total.deleted += part.deleted;
    total.bytesReclaimed += part.bytesReclaimed;
  }
  return total;
}

export type ScoutImageGcActivities = typeof scoutImageGcActivities;

export const scoutImageGcActivities = {
  async pruneScoutImages(
    rawInput: ScoutImageGcInput = {},
  ): Promise<ScoutImageGcResult> {
    const { retentionDays, dryRun } = InputSchema.parse(rawInput);
    const cutoff = new Date(Date.now() - retentionDays * MS_PER_DAY);
    const client = createScoutS3Client();
    const showcaseExemptKeys = await fetchShowcaseExemptKeys();

    const buckets: BucketPruneResult[] = [];
    for (const bucket of BUCKETS) {
      const exemptKeys =
        bucket === SHOWCASE_EXEMPT_BUCKET
          ? showcaseExemptKeys
          : new Set<string>();
      const result = await pruneBucket({
        client,
        bucket,
        cutoff,
        dryRun,
        exemptKeys,
      });
      buckets.push(result);
      console.warn(
        `[scout-image-gc] ${bucket}: scanned=${String(result.scanned)} matched=${String(result.matched)} deleted=${String(result.deleted)} bytes=${String(result.bytesReclaimed)}${dryRun ? " (dry-run)" : ""}`,
      );
    }

    const totalMatched = buckets.reduce((sum, b) => sum + b.matched, 0);
    const totalDeleted = buckets.reduce((sum, b) => sum + b.deleted, 0);
    const totalBytesReclaimed = buckets.reduce(
      (sum, b) => sum + b.bytesReclaimed,
      0,
    );

    return {
      dryRun,
      retentionDays,
      cutoff: cutoff.toISOString(),
      buckets,
      totalMatched,
      totalDeleted,
      totalBytesReclaimed,
    };
  },
};
