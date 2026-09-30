import { prisma } from "#src/database/index.ts";
import type { DurableFacts } from "#src/durable/match/durable-facts.ts";

/**
 * The recorder the running pipeline uses: the process's Prisma client and the
 * wall clock.
 *
 * It lives apart from the services so that importing a service never pulls the
 * database singleton in behind it — a caller already holding a transaction
 * client passes that instead, and a test passes its own client and a pinned
 * clock.
 */
export function liveDurableFacts(): DurableFacts {
  return { db: prisma, now: () => new Date() };
}
