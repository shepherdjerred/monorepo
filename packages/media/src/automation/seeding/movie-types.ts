import type { Prisma } from "#generated/prisma/client.ts";

export type MovieSourceCohort = Prisma.TorrentGetPayload<{
  include: { attempts: true; assets: { include: { coverage: true } } };
}>;
