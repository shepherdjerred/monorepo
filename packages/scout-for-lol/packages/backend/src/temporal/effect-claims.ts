import { z } from "zod";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { scoutTemporalDuplicateEffectClaims } from "#src/metrics/platform/temporal.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

/**
 * The effect kind every per-channel Discord send is claimed under. Named here
 * so the claim site and the queries that look those claims up cannot drift.
 */
export const DISCORD_CHANNEL_MESSAGE_EFFECT_KIND = "discord-channel-message";

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
 * Completed effects of one kind, claimed within a window, under one key prefix.
 *
 * The query is shaped for `ScoutEffectClaim`'s `[kind, state, claimedAt]`
 * index, which carries all three of those as an index condition and leaves the
 * key prefix as a cheap residual filter. The obvious formulation — a prefix
 * match on the primary key alone — is NOT usable here: Postgres can only serve
 * `LIKE 'prefix%'` from a btree under the C collation or a `text_pattern_ops`
 * index, and these databases are initdb'd `en_US.utf8`, so it would degrade to
 * a sequential scan on every call. The window is what keeps this bounded; the
 * caller derives it and owns its correctness.
 *
 * Rows are parsed, not filtered. A COMPLETED claim of a kind whose completions
 * all carry a result is expected to carry one, so a row that does not is a
 * broken contract and says so here, exactly as the single-key read above does.
 */
export async function listCompletedScoutEffects(
  args: {
    kind: string;
    keyPrefix: string;
    claimedFrom: Date;
    claimedUntil: Date;
  },
  database: ExtendedPrismaClient = prisma,
): Promise<CompletedScoutEffect[]> {
  const rows = await database.scoutEffectClaim.findMany({
    where: {
      kind: args.kind,
      state: "COMPLETED",
      claimedAt: { gte: args.claimedFrom, lte: args.claimedUntil },
      key: { startsWith: args.keyPrefix },
    },
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
