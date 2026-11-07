import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";

/** Persist the actual transaction identity, never a guessed timestamp or xmin
 * read from a detached composite value. This reads no provenance model row. */
export async function movieRollbackTransactionId(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw`SELECT txid_current()::text AS id`;
  return z
    .tuple([z.strictObject({ id: z.string().regex(/^[1-9]\d*$/u) })])
    .parse(rows)[0].id;
}
