import { z } from "zod";
import { Prisma, type Torrent } from "#generated/prisma/client.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  CleanupEvaluationSchema,
  type CleanupEvaluation,
} from "#shared/visibility/seeding.ts";

export type CleanupSnapshot = Pick<
  Torrent,
  "id" | "ownershipEpoch" | "seedingPolicy" | "observation" | "observedAt"
>;

export function cleanupDigest(value: unknown): string {
  return snapshotHash(z.json().parse(value));
}

/** A conditional observational write; never grants cleanup or refreshes raw observations. */
export async function recordCleanupEvaluation(
  db: Pick<Prisma.TransactionClient, "torrent" | "$queryRaw">,
  snapshot: CleanupSnapshot,
  input: Pick<
    CleanupEvaluation,
    "phase" | "status" | "reason" | "recoveryEpoch"
  > & { evaluatedAt: Date },
): Promise<boolean> {
  const current = await db.torrent.findUniqueOrThrow({
    where: { id: snapshot.id },
  });
  if (
    current.ownershipEpoch !== snapshot.ownershipEpoch ||
    current.observedAt?.getTime() !== snapshot.observedAt?.getTime() ||
    cleanupDigest(current.seedingPolicy) !==
      cleanupDigest(snapshot.seedingPolicy) ||
    cleanupDigest(current.observation) !== cleanupDigest(snapshot.observation)
  )
    return false;
  if (
    current.cleanupEvaluation !== null &&
    new Date(
      CleanupEvaluationSchema.parse(current.cleanupEvaluation).evaluatedAt,
    ) > input.evaluatedAt
  )
    return false;
  const [binding] = z
    .array(z.object({ digest: z.string() }))
    .parse(
      await db.$queryRaw`SELECT md5(jsonb_build_array("seedingPolicy", observation)::text) AS digest FROM "Torrent" WHERE id=${snapshot.id}`,
    );
  if (binding === undefined)
    throw new Error("Torrent observation binding missing");
  const value = CleanupEvaluationSchema.parse({
    ...input,
    schemaVersion: 1,
    evaluatedAt: input.evaluatedAt.toISOString(),
    observedAt: snapshot.observedAt?.toISOString() ?? null,
    ownershipEpoch: snapshot.ownershipEpoch,
    policyDigest: cleanupDigest(snapshot.seedingPolicy),
    observationDigest: cleanupDigest(snapshot.observation),
    databaseDigest: binding.digest,
  });
  const result = await db.torrent.updateMany({
    where: {
      id: snapshot.id,
      ownershipEpoch: snapshot.ownershipEpoch,
      observedAt: snapshot.observedAt,
      seedingPolicy: { equals: snapshot.seedingPolicy ?? Prisma.JsonNull },
      observation: { equals: snapshot.observation ?? Prisma.DbNull },
      cleanupEvaluation: { equals: current.cleanupEvaluation ?? Prisma.DbNull },
    },
    data: { cleanupEvaluation: value },
  });
  return result.count === 1;
}
