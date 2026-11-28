import {
  GetObjectCommand,
  PutObjectCommand,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  RankedRenovateUpdateSchema,
  RenovateDispositionSchema,
  RenovateRankingSnapshotSchema,
  type RenovateRankedQueue,
  type RenovateRankingSnapshot,
} from "@shepherdjerred/ops-model/renovate-ranking.ts";
import { z } from "zod/v4";
import { createSeaweedS3Client } from "#activities/ops/renovate-delta/s3-cache.ts";

const ROOT = "renovate-ranking/v1";
const RANKING_KEY = `${ROOT}/latest.json`;
const DISPATCH_KEY = `${ROOT}/dispatch.json`;
const RECENT_MS = 30 * 24 * 60 * 60 * 1000;

const CommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
export const PublicationSchema = z.object({
  branch: z.string().regex(/^chore\/renovate-bundle-[a-f0-9]{16}$/u),
  title: z.string(),
  body: z.string(),
  headSha: CommitShaSchema,
  observedHeadSha: CommitShaSchema.optional(),
  baseSha: CommitShaSchema,
  plannedAt: z.iso.datetime(),
  files: z.array(z.string()),
  candidates: z.array(RankedRenovateUpdateSchema),
  prNumber: z.number().int().positive().optional(),
  state: z.enum(["open", "merged", "closed"]).optional(),
  woodpeckerSeen: z.boolean().default(false),
});
export type Publication = z.infer<typeof PublicationSchema>;

const DispatchStateSchema = z.object({
  dispositions: z.record(z.string(), RenovateDispositionSchema),
  publications: z.record(z.string(), PublicationSchema),
});
export type DispatchState = z.infer<typeof DispatchStateSchema>;
export type DispatchRecord = { value: DispatchState; etag?: string };

export function createRenovateStore() {
  const { client, bucket } = createSeaweedS3Client();

  async function read<T extends z.ZodType>(key: string, schema: T) {
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        {
          abortSignal: AbortSignal.timeout(15_000),
        },
      );
      if (result.Body === undefined || result.ETag === undefined) {
        throw new Error(
          `Renovate store returned an incomplete object for ${key}`,
        );
      }
      return {
        value: schema.parse(JSON.parse(await result.Body.transformToString())),
        etag: result.ETag,
      };
    } catch (error: unknown) {
      if (
        !(error instanceof S3ServiceException) ||
        error.$metadata.httpStatusCode !== 404
      )
        throw error;
      return;
    }
  }

  async function write(key: string, value: unknown, etag: string | undefined) {
    const result = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json",
        ...(etag === undefined ? { IfNoneMatch: "*" } : { IfMatch: etag }),
      }),
      { abortSignal: AbortSignal.timeout(15_000) },
    );
    if (result.ETag === undefined)
      throw new Error(`Renovate store write has no ETag for ${key}`);
    return result.ETag;
  }

  return {
    async readRanking(): Promise<RenovateRankingSnapshot | undefined> {
      const result = await read(RANKING_KEY, RenovateRankingSnapshotSchema);
      return result?.value;
    },
    async writeRanking(snapshot: RenovateRankingSnapshot): Promise<void> {
      const previous = await read(RANKING_KEY, RenovateRankingSnapshotSchema);
      if (
        previous !== undefined &&
        previous.value.scannedAt >= snapshot.scannedAt
      )
        return;
      await write(
        RANKING_KEY,
        RenovateRankingSnapshotSchema.parse(snapshot),
        previous?.etag,
      );
    },
    async readDispatch(): Promise<DispatchRecord> {
      return (
        (await read(DISPATCH_KEY, DispatchStateSchema)) ?? {
          value: { dispositions: {}, publications: {} },
        }
      );
    },
    async writeDispatch(record: DispatchRecord): Promise<DispatchRecord> {
      return {
        value: record.value,
        etag: await write(
          DISPATCH_KEY,
          DispatchStateSchema.parse(record.value),
          record.etag,
        ),
      };
    },
  };
}

export async function readLatestRenovateQueue(): Promise<
  RenovateRankedQueue | undefined
> {
  if (Bun.env["S3_ENDPOINT"] === undefined) return;
  const store = createRenovateStore();
  const [snapshot, dispatch] = await Promise.all([
    store.readRanking(),
    store.readDispatch(),
  ]);
  if (snapshot === undefined) return;
  const cutoff = Date.now() - RECENT_MS;
  const candidates = new Map(
    snapshot.candidates.map((candidate) => [candidate.id, candidate]),
  );
  for (const publication of Object.values(dispatch.value.publications)) {
    for (const candidate of publication.candidates) {
      const disposition = dispatch.value.dispositions[candidate.id];
      if (
        disposition !== undefined &&
        !candidates.has(candidate.id) &&
        (disposition.status === "published" ||
          Date.parse(disposition.updatedAt) >= cutoff)
      ) {
        candidates.set(candidate.id, candidate);
      }
    }
  }
  return {
    snapshot: { ...snapshot, candidates: [...candidates.values()] },
    dispositions: dispatch.value.dispositions,
  };
}
