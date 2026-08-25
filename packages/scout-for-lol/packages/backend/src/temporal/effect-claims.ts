import { z } from "zod";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { scoutTemporalDuplicateEffectClaims } from "#src/metrics/temporal.ts";

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

export async function requireCompletedScoutEffectResult(
  key: string,
  database: ExtendedPrismaClient = prisma,
): Promise<string> {
  const claim = await database.scoutEffectClaim.findUniqueOrThrow({
    where: { key },
    select: { state: true, resultId: true },
  });
  if (claim.state !== "COMPLETED" || claim.resultId === null) {
    throw new Error(`Completed effect ${key} has no durable result ID`);
  }
  return claim.resultId;
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
