import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "#generated/prisma/client.ts";
import type { ManualLinkRecord } from "#domain/resolver.ts";
import {
  normalizeShortSlug,
  type UpsertManualLinkInput,
} from "#shared/contract.ts";
import type { SeedEntry } from "./config.ts";

export type ManualLinkRepository = {
  readonly list: () => Promise<ManualLinkRecord[]>;
  readonly findByShort: (short: string) => Promise<ManualLinkRecord | null>;
  readonly upsert: (
    input: UpsertManualLinkInput,
    createdBy: string,
  ) => Promise<ManualLinkRecord>;
  readonly delete: (short: string) => Promise<boolean>;
  readonly recordClick: (short: string) => Promise<void>;
  readonly ping: () => Promise<boolean>;
  readonly seedIfMissing: (entries: readonly SeedEntry[]) => Promise<number>;
  readonly close: () => Promise<void>;
};

export function createDatabase(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function createPrismaManualLinkRepository(
  prisma: PrismaClient,
): ManualLinkRepository {
  return {
    list: async () => prisma.manualLink.findMany({ orderBy: { short: "asc" } }),

    findByShort: async (short) =>
      prisma.manualLink.findUnique({
        where: { short: normalizeShortSlug(short) },
      }),

    upsert: async (input, createdBy) => {
      const normalizedShort = normalizeShortSlug(input.short);
      return prisma.manualLink.upsert({
        where: { short: normalizedShort },
        create: {
          short: normalizedShort,
          targetUrl: input.targetUrl,
          createdBy,
        },
        update: {
          targetUrl: input.targetUrl,
          createdBy,
        },
      });
    },

    delete: async (short) => {
      const deleted = await prisma.manualLink.deleteMany({
        where: { short: normalizeShortSlug(short) },
      });
      return deleted.count > 0;
    },

    recordClick: async (short) => {
      await prisma.manualLink.updateMany({
        where: { short: normalizeShortSlug(short) },
        data: {
          clicks: { increment: 1 },
          lastClickedAt: new Date(),
        },
      });
    },

    ping: async () => {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
      } catch {
        return false;
      }
    },

    seedIfMissing: async (entries) => {
      if (entries.length === 0) {
        return 0;
      }
      const now = new Date();
      const result = await prisma.manualLink.createMany({
        data: entries.map((entry) => ({
          short: normalizeShortSlug(entry.short),
          targetUrl: entry.targetUrl,
          createdBy: entry.createdBy,
          updatedAt: now,
        })),
        skipDuplicates: true,
      });
      return result.count;
    },

    close: async () => {
      await prisma.$disconnect();
    },
  };
}

export function createInMemoryManualLinkRepository(options?: {
  readonly initial?: readonly SeedEntry[];
  readonly healthy?: () => boolean;
}): ManualLinkRepository {
  const store = new Map<string, ManualLinkRecord>();
  const isHealthy = options?.healthy ?? (() => true);

  for (const entry of options?.initial ?? []) {
    const short = normalizeShortSlug(entry.short);
    if (!store.has(short)) {
      const now = new Date();
      store.set(short, {
        short,
        targetUrl: entry.targetUrl,
        createdBy: entry.createdBy,
        clicks: 0,
        lastClickedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return {
    list: () =>
      Promise.resolve(
        [...store.values()].sort((left, right) =>
          left.short.localeCompare(right.short),
        ),
      ),

    findByShort: (short) =>
      Promise.resolve(store.get(normalizeShortSlug(short)) ?? null),

    upsert: (input, createdBy) => {
      const short = normalizeShortSlug(input.short);
      const now = new Date();
      const existing = store.get(short);
      const updated: ManualLinkRecord =
        existing === undefined
          ? {
              short,
              targetUrl: input.targetUrl,
              createdBy,
              clicks: 0,
              lastClickedAt: null,
              createdAt: now,
              updatedAt: now,
            }
          : {
              ...existing,
              targetUrl: input.targetUrl,
              createdBy,
              updatedAt: now,
            };
      store.set(short, updated);
      return Promise.resolve(updated);
    },

    delete: (short) => Promise.resolve(store.delete(normalizeShortSlug(short))),

    recordClick: (short) => {
      const key = normalizeShortSlug(short);
      const existing = store.get(key);
      if (existing !== undefined) {
        store.set(key, {
          ...existing,
          clicks: existing.clicks + 1,
          lastClickedAt: new Date(),
        });
      }
      return Promise.resolve();
    },

    ping: () => Promise.resolve(isHealthy()),

    seedIfMissing: (entries) => {
      let inserted = 0;
      const now = new Date();
      for (const entry of entries) {
        const short = normalizeShortSlug(entry.short);
        if (!store.has(short)) {
          store.set(short, {
            short,
            targetUrl: entry.targetUrl,
            createdBy: entry.createdBy,
            clicks: 0,
            lastClickedAt: null,
            createdAt: now,
            updatedAt: now,
          });
          inserted += 1;
        }
      }
      return Promise.resolve(inserted);
    },

    close: () => Promise.resolve(),
  };
}
