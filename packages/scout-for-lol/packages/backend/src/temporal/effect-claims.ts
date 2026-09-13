import { z } from "zod";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { scoutTemporalDuplicateEffectClaims } from "#src/metrics/platform/temporal.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export async function claimScoutEffect(
  input: {
    key: string;
    kind: string;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<"execute" | "completed"> {
  try {
    await database.scoutEffectClaim.create({ data: input });
    return "execute";
  } catch (error) {
    if (!UniqueViolationSchema.safeParse(error).success) throw error;
    const existing = await database.scoutEffectClaim.findUniqueOrThrow({
      where: { key: input.key },
      select: { kind: true, state: true },
    });
    if (existing.kind !== input.kind) {
      scoutTemporalDuplicateEffectClaims.inc({
        kind: input.kind,
        outcome: "kind_mismatch",
      });
      throw new Error(
        `Effect key ${input.key} belongs to ${existing.kind}, not ${input.kind}`,
        { cause: error },
      );
    }
    if (existing.state === "COMPLETED") {
      scoutTemporalDuplicateEffectClaims.inc({
        kind: input.kind,
        outcome: "completed",
      });
      return "completed";
    }
    scoutTemporalDuplicateEffectClaims.inc({
      kind: input.kind,
      outcome: "ambiguous_retry",
    });
    return "execute";
  }
}

async function persistCompletedScoutEffect(
  key: string,
  resultId: string | undefined,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  await database.scoutEffectClaim.update({
    where: { key },
    data: {
      state: "COMPLETED",
      completedAt: new Date(),
      lastError: null,
      ...(resultId === undefined ? {} : { resultId }),
    },
  });
}

export async function completeScoutEffect(
  key: string,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  await persistCompletedScoutEffect(key, undefined, database);
}

export async function completeScoutEffectWithResult(
  key: string,
  resultId: string,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  await persistCompletedScoutEffect(key, resultId, database);
}

/**
 * A side effect this pipeline already performed, and when it performed it.
 *
 * The two instants bracket the effect itself: the claim row is created
 * immediately BEFORE the effect runs and completed immediately AFTER it
 * returns, so `claimedAt` is this system's own record of when the effect began
 * and `completedAt` of when it was observed to have happened. A later pass
 * recovering the effect has no other first-party record of either.
 */
export type CompletedScoutEffect = {
  key: string;
  resultId: string;
  claimedAt: Date;
  completedAt: Date;
};

const CompletedScoutEffectSchema = z.object({
  key: z.string(),
  resultId: z.string(),
  claimedAt: z.date(),
  completedAt: z.date(),
});

export async function requireCompletedScoutEffectResult(
  key: string,
  database: ExtendedPrismaClient = prisma,
): Promise<CompletedScoutEffect> {
  const claim = await database.scoutEffectClaim.findUniqueOrThrow({
    where: { key },
    select: {
      key: true,
      state: true,
      resultId: true,
      claimedAt: true,
      completedAt: true,
    },
  });
  if (claim.state !== "COMPLETED" || claim.resultId === null) {
    throw new Error(`Completed effect ${key} has no durable result ID`);
  }
  return CompletedScoutEffectSchema.parse(claim);
}

/**
 * Every completed effect under one key prefix.
 *
 * Scoped to a prefix rather than scanning, because the caller is a recovery
 * path that runs on ordinary polls: it asks only about the keys one match
 * could own, and a match with nothing to recover costs one indexed lookup that
 * returns no rows.
 *
 * Rows are parsed, not filtered. A COMPLETED claim under a prefix whose
 * completions all carry a result is expected to carry one, so a row that does
 * not is a broken contract and says so here, exactly as the single-key read
 * above does.
 */
export async function listCompletedScoutEffects(
  keyPrefix: string,
  database: ExtendedPrismaClient = prisma,
): Promise<CompletedScoutEffect[]> {
  const rows = await database.scoutEffectClaim.findMany({
    where: { key: { startsWith: keyPrefix }, state: "COMPLETED" },
    select: {
      key: true,
      resultId: true,
      claimedAt: true,
      completedAt: true,
    },
  });
  return rows.map((row) => CompletedScoutEffectSchema.parse(row));
}

export async function recordScoutEffectFailure(
  key: string,
  error: unknown,
  database: ExtendedPrismaClient = prisma,
): Promise<void> {
  await database.scoutEffectClaim.update({
    where: { key },
    data: {
      state: "AMBIGUOUS_OR_FAILED",
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}
