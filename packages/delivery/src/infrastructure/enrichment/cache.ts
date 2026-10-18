import type { Database } from "#infrastructure/database.ts";
import type { Prisma } from "#generated/prisma/client.ts";

export type SnapshotSource = "woodpecker" | "github";
export type Snapshot = { payload: unknown; fetchedAt: Date; final: boolean };

/** A cached upstream answer is reusable once final, or while young enough. */
export function isFresh(
  snapshot: Pick<Snapshot, "fetchedAt" | "final">,
  now: Date,
  ttlMs: number,
) {
  return snapshot.final || now.getTime() - snapshot.fetchedAt.getTime() < ttlMs;
}

/**
 * Read-through cache of upstream answers in PostgreSQL. Concurrent reads of
 * one key share a single upstream request.
 */
export function createSnapshotCache(
  database: Database,
  now = () => new Date(),
) {
  const inflight = new Map<string, Promise<Snapshot>>();
  return async function read(options: {
    source: SnapshotSource;
    key: string;
    ttlMs: number;
    fetch: () => Promise<{ payload: Prisma.InputJsonValue; final: boolean }>;
  }): Promise<Snapshot> {
    const cached = await database.integrationSnapshot.findUnique({
      where: { source_key: { source: options.source, key: options.key } },
    });
    if (cached !== null && isFresh(cached, now(), options.ttlMs)) return cached;
    const flightKey = `${options.source}:${options.key}`;
    const pending = inflight.get(flightKey);
    if (pending !== undefined) return pending;
    const request = (async () => {
      const fetched = await options.fetch();
      const fetchedAt = now();
      await database.integrationSnapshot.upsert({
        where: { source_key: { source: options.source, key: options.key } },
        create: {
          source: options.source,
          key: options.key,
          payload: fetched.payload,
          final: fetched.final,
          fetchedAt,
        },
        update: {
          payload: fetched.payload,
          final: fetched.final,
          fetchedAt,
        },
      });
      return { payload: fetched.payload, final: fetched.final, fetchedAt };
    })();
    inflight.set(flightKey, request);
    try {
      return await request;
    } finally {
      inflight.delete(flightKey);
    }
  };
}
export type SnapshotCache = ReturnType<typeof createSnapshotCache>;
