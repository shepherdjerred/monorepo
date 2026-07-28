import { GetObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod/v4";
import {
  createCorpusStoresFromEnv,
  isNotFoundError,
  isPreconditionFailedError,
  putMutableJson,
  type CorpusStore,
} from "./glitter-corpus-store.ts";

export const DiscordRequestLeaseSchema = z
  .object({
    schemaVersion: z.literal(2),
    holder: z.uuid().nullable(),
    leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
    nextRequestAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.holder === null) !== (value.leaseExpiresAt === null)) {
      context.addIssue({
        code: "custom",
        message: "lease holder and expiry must both be set or both be null",
      });
    }
  });
export type DiscordRequestLease = z.infer<typeof DiscordRequestLeaseSchema>;

type VersionedDiscordRequestLease = {
  etag: string;
  lease: DiscordRequestLease;
};

export type GlitterDiscordRateLimitStorage = {
  read: () => Promise<VersionedDiscordRequestLease | undefined>;
  compareAndSwap: (input: {
    expectedEtag: string | undefined;
    lease: DiscordRequestLease;
  }) => Promise<boolean>;
};

export type GlitterDiscordRateLimitCoordinator = {
  tryAcquire: (input: {
    holder: string;
    nowMs: number;
  }) => Promise<{ acquired: boolean; retryAfterMs: number }>;
  release: (input: {
    holder: string;
    completedAtMs: number;
    notBeforeMs?: number;
  }) => Promise<boolean>;
};

const DISCORD_REQUEST_LEASE_KEY =
  "coordination/glitter-discord-request-rate-limit.json";
const DISCORD_REQUEST_INTERVAL_MS = 1000;
const DISCORD_IN_FLIGHT_LEASE_MS = 60_000;
const LEASE_CAS_RETRY_MS = 50;

async function readDiscordRequestLease(
  store: CorpusStore,
): Promise<VersionedDiscordRequestLease | undefined> {
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

async function compareAndSwapDiscordRequestLease(input: {
  store: CorpusStore;
  expectedEtag: string | undefined;
  lease: DiscordRequestLease;
}): Promise<boolean> {
  try {
    await putMutableJson(
      input.store,
      DISCORD_REQUEST_LEASE_KEY,
      DiscordRequestLeaseSchema.parse(input.lease),
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

export function discordRequestLeaseAvailabilityDelayMs(
  lease: DiscordRequestLease,
  nowMs: number,
): number {
  const requestDelay = discordRequestLeaseDelayMs(lease.nextRequestAt, nowMs);
  const holderDelay =
    lease.holder === null || lease.leaseExpiresAt === null
      ? 0
      : Math.max(0, Date.parse(lease.leaseExpiresAt) - nowMs);
  return Math.max(requestDelay, holderDelay);
}

export function createGlitterDiscordRateLimitCoordinatorWithStorage(
  storage: GlitterDiscordRateLimitStorage,
): GlitterDiscordRateLimitCoordinator {
  return {
    async tryAcquire(input) {
      const existing = await storage.read();
      if (existing !== undefined) {
        const retryAfterMs = discordRequestLeaseAvailabilityDelayMs(
          existing.lease,
          input.nowMs,
        );
        if (retryAfterMs > 0) {
          return { acquired: false, retryAfterMs };
        }
      }
      const acquired = await storage.compareAndSwap({
        expectedEtag: existing?.etag,
        lease: DiscordRequestLeaseSchema.parse({
          schemaVersion: 2,
          holder: input.holder,
          leaseExpiresAt: new Date(
            input.nowMs + DISCORD_IN_FLIGHT_LEASE_MS,
          ).toISOString(),
          nextRequestAt:
            existing?.lease.nextRequestAt ??
            new Date(input.nowMs).toISOString(),
        }),
      });
      return {
        acquired,
        retryAfterMs: acquired ? 0 : LEASE_CAS_RETRY_MS,
      };
    },
    async release(input) {
      for (;;) {
        const existing = await storage.read();
        if (existing?.lease.holder !== input.holder) {
          return false;
        }
        const nextRequestAtMs = Math.max(
          Date.parse(existing.lease.nextRequestAt),
          input.completedAtMs + DISCORD_REQUEST_INTERVAL_MS,
          input.notBeforeMs ?? 0,
        );
        const released = await storage.compareAndSwap({
          expectedEtag: existing.etag,
          lease: DiscordRequestLeaseSchema.parse({
            schemaVersion: 2,
            holder: null,
            leaseExpiresAt: null,
            nextRequestAt: new Date(nextRequestAtMs).toISOString(),
          }),
        });
        if (released) {
          return true;
        }
      }
    },
  };
}

export function createGlitterDiscordRateLimitCoordinator(): GlitterDiscordRateLimitCoordinator {
  const [store] = createCorpusStoresFromEnv();
  return createGlitterDiscordRateLimitCoordinatorWithStorage({
    read: async () => await readDiscordRequestLease(store),
    compareAndSwap: async (input) =>
      await compareAndSwapDiscordRequestLease({ store, ...input }),
  });
}
