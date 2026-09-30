import { z } from "zod";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { scoutTemporalDuplicateEffectClaims } from "#src/metrics/platform/temporal.ts";

/**
 * At-most-once guards for effects whose second application would be visible.
 *
 * ## Why these take the top-level client, and will keep taking it
 *
 * Every function here accepts an {@link ExtendedPrismaClient}, not the
 * transaction-scoped `Db` the durable repositories take, so a claim can never
 * commit atomically with the durable fact it guards. That looks like a gap
 * worth closing — widen the parameter to `Db` and a caller inside a
 * `$transaction` could enlist the guard — and it is not one, for a reason
 * that is about Postgres rather than about typing.
 *
 * {@link claimScoutEffect} is an insert that EXPECTS to fail. Its whole
 * protocol is: create the row; on a unique violation, read the existing row
 * back and decide from its `kind` and `state` whether this caller may execute.
 * In Postgres a constraint violation aborts the surrounding transaction, and
 * every subsequent statement in it fails with `current transaction is aborted`
 * until a rollback. Inside a transaction the read-back — the step that
 * separates "already completed" from "a previous attempt claimed and did not
 * finish" — could not run at all. The idiom is only correct against a client
 * that is not already inside a transaction.
 *
 * So the V2 Activity contracts do not treat two commits as a limitation to
 * design around: `ScoutGuardedEffectV2Result` reports `guard` and `fact` as
 * separate outcomes precisely because they ARE separate commits, and a run
 * that claimed the guard and died before the fact is expected to come back and
 * find `guard: already-applied` with `fact: applied`. That reconcile is
 * observable and correct; an atomic guard built on an aborted transaction
 * would be neither.
 */

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

/**
 * The effect kind every per-channel Discord send is claimed under. Named here
 * so the claim site and the queries that look those claims up cannot drift.
 */
export const DISCORD_CHANNEL_MESSAGE_EFFECT_KIND = "discord-channel-message";

/**
 * The `state` column's vocabulary. Parsed rather than trusted: the column is a
 * plain string, so a value outside this set is malformed persisted data and
 * must fail loudly instead of being read as some other state.
 */
export const ScoutEffectClaimStateSchema = z.enum([
  "CLAIMED",
  "COMPLETED",
  "AMBIGUOUS_OR_FAILED",
]);
export type ScoutEffectClaimState = z.infer<typeof ScoutEffectClaimStateSchema>;

export type ScoutEffectClaimRecord = z.infer<
  typeof ScoutEffectClaimRecordSchema
>;
const ScoutEffectClaimRecordSchema = z.object({
  key: z.string(),
  kind: z.string(),
  state: ScoutEffectClaimStateSchema,
  resultId: z.string().nullable(),
});

/**
 * What is recorded against an effect key right now, or `null` for none.
 *
 * This is the third read in this module and the only one that answers about a
 * claim in ANY state, which is what separates it from the two below.
 * `requireCompletedScoutEffectResult` and `listCompletedScoutEffects` are
 * about effects that finished and left a result to recover — a Discord message
 * id — so both require a `resultId` and treat its absence as a broken
 * contract. A V2 guarded effect has no such result: `completeScoutEffect`
 * records that settlement or progression happened, not what it produced. It
 * also has to see the states those reads exclude, because CLAIMED and
 * AMBIGUOUS_OR_FAILED are precisely the histories it reports on.
 *
 * That is the reason this read exists at all. {@link claimScoutEffect} answers
 * what a caller may DO, which deliberately collapses two histories: a first
 * claim and a retry of a claim a previous attempt left unfinished both answer
 * `execute`. A guarded V2 Activity has to report those apart — the first is
 * its guard being `applied`, the second is `already-applied` and names the
 * reconcile the contracts model — so it reads the claim before making one.
 *
 * The read and the claim are two statements, so two racing first attempts can
 * both observe `null`. That race is bounded and benign: the CLAIM is still
 * decided by the unique constraint, so only one of them executes the effect,
 * and it is the `fact` outcome rather than the `guard` one that says whether
 * the effect was applied twice.
 */
export async function getScoutEffectClaim(
  key: string,
  database: ExtendedPrismaClient = prisma,
): Promise<ScoutEffectClaimRecord | null> {
  const claim = await database.scoutEffectClaim.findUnique({
    where: { key },
    select: { key: true, kind: true, state: true, resultId: true },
  });
  return claim === null ? null : ScoutEffectClaimRecordSchema.parse(claim);
}

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
