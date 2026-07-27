import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import {
  createCorpusStoresFromEnv,
  isNotFoundError,
  isPreconditionFailedError,
  putMutableJson,
  type CorpusStore,
} from "./glitter-corpus-store.ts";

const DiscordRequestLeaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    holder: z.uuid(),
    nextRequestAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type GlitterDiscordRateLimitCoordinator = {
  tryAcquire: (input: {
    holder: string;
    nowMs: number;
  }) => Promise<{ acquired: boolean; retryAfterMs: number }>;
  tryDeferUntil: (input: {
    holder: string;
    notBeforeMs: number;
  }) => Promise<boolean>;
};

const DISCORD_REQUEST_LEASE_KEY =
  "coordination/glitter-discord-request-rate-limit.json";
const DISCORD_REQUEST_INTERVAL_MS = 1000;
const LEASE_CAS_RETRY_MS = 50;

async function readDiscordRequestLease(store: CorpusStore): Promise<
  | {
      etag: string;
      lease: z.infer<typeof DiscordRequestLeaseSchema>;
    }
  | undefined
> {
  try {
    const response = await store.client.send(
      new GetObjectCommand({
        Bucket: store.bucket,
        Key: DISCORD_REQUEST_LEASE_KEY,
      }),
    );
    if (response.Body === undefined || response.ETag === undefined) {
      throw new Error(
        `${store.name} returned incomplete Discord request lease metadata`,
      );
    }
    const bytes = await response.Body.transformToByteArray();
    return {
      etag: response.ETag,
      lease: DiscordRequestLeaseSchema.parse(
        JSON.parse(new TextDecoder().decode(bytes)),
      ),
    };
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function tryWriteDiscordRequestLease(input: {
  store: CorpusStore;
  holder: string;
  nextRequestAtMs: number;
  expectedEtag: string | undefined;
}): Promise<boolean> {
  try {
    await putMutableJson(
      input.store,
      DISCORD_REQUEST_LEASE_KEY,
      DiscordRequestLeaseSchema.parse({
        schemaVersion: 1,
        holder: input.holder,
        nextRequestAt: new Date(input.nextRequestAtMs).toISOString(),
      }),
      input.expectedEtag,
    );
    return true;
  } catch (error: unknown) {
    if (isPreconditionFailedError(error)) {
      return false;
    }
    throw error;
  }
}

export function discordRequestLeaseDelayMs(
  nextRequestAt: string,
  nowMs: number,
): number {
  return Math.max(0, Date.parse(nextRequestAt) - nowMs);
}

export function createGlitterDiscordRateLimitCoordinator(): GlitterDiscordRateLimitCoordinator {
  const [store] = createCorpusStoresFromEnv();
  return {
    async tryAcquire(input) {
      const existing = await readDiscordRequestLease(store);
      if (existing !== undefined) {
        const retryAfterMs = discordRequestLeaseDelayMs(
          existing.lease.nextRequestAt,
          input.nowMs,
        );
        if (retryAfterMs > 0) {
          return { acquired: false, retryAfterMs };
        }
      }
      const acquired = await tryWriteDiscordRequestLease({
        store,
        holder: input.holder,
        nextRequestAtMs: input.nowMs + DISCORD_REQUEST_INTERVAL_MS,
        expectedEtag: existing?.etag,
      });
      return {
        acquired,
        retryAfterMs: acquired ? 0 : LEASE_CAS_RETRY_MS,
      };
    },
    async tryDeferUntil(input) {
      const existing = await readDiscordRequestLease(store);
      const existingNextRequestAtMs =
        existing === undefined ? 0 : Date.parse(existing.lease.nextRequestAt);
      if (existingNextRequestAtMs >= input.notBeforeMs) {
        return true;
      }
      return await tryWriteDiscordRequestLease({
        store,
        holder: input.holder,
        nextRequestAtMs: input.notBeforeMs,
        expectedEtag: existing?.etag,
      });
    },
  };
}
