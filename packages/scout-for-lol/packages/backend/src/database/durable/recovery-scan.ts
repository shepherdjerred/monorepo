import { z } from "zod";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { ReceiptKind } from "@scout-for-lol/domain/match-processing/states.ts";
import type { Db } from "#src/database/index.ts";

/**
 * A recovery batch's reads: the gap a crash leaves between the object store and
 * the durable observation.
 *
 * The gap is matches whose raw payload was archived — there is a
 * `raw-archive-match` receipt attesting to the bytes — but which no
 * `MatchObservation` row records Scout as having seen. Nothing downstream can
 * run for such a match, and nothing ever will: the run that would have
 * committed the observation is the run that died.
 *
 * Every query here is bounded ABOVE by the batch's own creation instant. That
 * bound is what makes a batch a fixed unit of work rather than a tail it can
 * never catch: receipts are append-only and never deleted, so the archive range
 * a batch was created over cannot grow, and matches archived after it belong to
 * the live pipeline. The range only ever SHRINKS, as matches in it gain
 * observations — which is exactly the outcome the batch is working towards, and
 * why `processRecoveryPageV2` can page the remaining work from the front
 * without a stored position.
 *
 * The two anti-join families are raw SQL for the reason
 * `pipeline-scan.ts` gives: `MatchProcessingReceipt` and `MatchObservation` are
 * joined by value with no Prisma relation between them, so there is no `none:`
 * filter to reach for. Fetching a window and filtering it in TypeScript would
 * destroy the property the processing page depends on — a page that came back
 * short has to mean the remaining work is short, not that the window happened
 * to be full of matches somebody already recovered.
 *
 * The archive receipt kind arrives as an argument rather than being imported:
 * it belongs to `report-lake/`, and a repository that reached into a feature
 * slice would stop being callable from a migration script or a fixture.
 */

/**
 * The ordering key of one match within a batch's archive range.
 *
 * `recordedAt` alone does not order the range — two archives of one poll's
 * matches share an instant to the millisecond — so the match id breaks the tie.
 * Together they are a total order over `MatchProcessingReceipt`, which is what
 * lets a resumed scan say "everything strictly after this point is still
 * unread" and mean it.
 */
export type RecoveryScanPosition = {
  readonly recordedAt: Date;
  readonly riotMatchId: RiotMatchId;
};

/**
 * The wire form of a position, as the cursor column stores it.
 *
 * `RecoveryScanCursor.position` is an opaque resume token to the pure machine —
 * it compares tokens for equality and never looks inside one — so the token's
 * shape is this module's contract with itself, and parsing it is how a stored
 * column that is not one is caught. A malformed token is a broken internal
 * contract rather than bad input: nothing but this file ever writes one, so the
 * only way to meet a bad one is for the format to have changed under a batch
 * that is still running, and resuming a scan from a position nobody can locate
 * would silently re-read or skip an arbitrary stretch of the range.
 */
const RECOVERY_POSITION_SEPARATOR = "|";

const RecoveryScanPositionTokenSchema = z.strictObject({
  recordedAt: IsoInstantSchema,
  riotMatchId: RiotMatchIdSchema,
});

export function recoveryScanToken(position: RecoveryScanPosition): string {
  const token = RecoveryScanPositionTokenSchema.parse({
    recordedAt: position.recordedAt.toISOString(),
    riotMatchId: position.riotMatchId,
  });
  return `${token.recordedAt}${RECOVERY_POSITION_SEPARATOR}${token.riotMatchId}`;
}

export function recoveryScanPosition(token: string): RecoveryScanPosition {
  const [recordedAt, riotMatchId, ...extra] = token.split(
    RECOVERY_POSITION_SEPARATOR,
  );
  if (extra.length > 0) {
    throw new Error(
      `Recovery scan position "${token}" carries more than one "${RECOVERY_POSITION_SEPARATOR}": it is not a "<recordedAt>|<riotMatchId>" token`,
    );
  }
  const parsed = RecoveryScanPositionTokenSchema.parse({
    recordedAt,
    riotMatchId,
  });
  return {
    recordedAt: new Date(parsed.recordedAt),
    riotMatchId: parsed.riotMatchId,
  };
}

/**
 * One bounded page of the batch's archive range, resumed from a position.
 *
 * This walks the RANGE — every archived match under the batch's upper bound —
 * rather than the gap, and that is what the scan phase is for. The range is
 * fixed, so a page that came back short means the scan has reached the end of
 * the batch's work and will never have more; a page of the gap would shrink
 * under the scan as the live pipeline observed matches, and a cursor walking it
 * could report "exhausted" over a range it had barely started.
 *
 * Rides `MatchProcessingReceipt(kind, recordedAt)`: equality on the leading
 * column, the ordering on the second, with the keyset predicate spelled as the
 * two-branch comparison Prisma can express rather than a row-value one it
 * cannot.
 */
export async function listArchivedMatchPage(
  db: Db,
  args: {
    archiveReceiptKind: ReceiptKind;
    recordedThrough: Date;
    after: RecoveryScanPosition | undefined;
    limit: number;
  },
): Promise<RecoveryScanPosition[]> {
  const rows = await db.matchProcessingReceipt.findMany({
    where: {
      kind: args.archiveReceiptKind,
      recordedAt: { lte: args.recordedThrough },
      ...(args.after === undefined
        ? {}
        : {
            OR: [
              { recordedAt: { gt: args.after.recordedAt } },
              {
                recordedAt: args.after.recordedAt,
                riotMatchId: { gt: args.after.riotMatchId },
              },
            ],
          }),
    },
    orderBy: [{ recordedAt: "asc" }, { riotMatchId: "asc" }],
    take: args.limit,
    select: { riotMatchId: true, recordedAt: true },
  });
  return rows.map((row) => ({
    riotMatchId: RiotMatchIdSchema.parse(row.riotMatchId),
    recordedAt: row.recordedAt,
  }));
}

/**
 * Which of these matches are already observed.
 *
 * Bounded by its own argument: `riotMatchId` is the observation table's primary
 * key, so the result cannot exceed the page it was asked about. The scan needs
 * this as a second read rather than an anti-join because it has already paid
 * for the page — the question is about a known set of ids, and answering it in
 * SQL would mean re-deriving that set.
 */
export async function listObservedMatches(
  db: Db,
  args: { riotMatchIds: readonly RiotMatchId[] },
): Promise<RiotMatchId[]> {
  if (args.riotMatchIds.length === 0) {
    return [];
  }
  const rows = await db.matchObservation.findMany({
    where: { riotMatchId: { in: [...args.riotMatchIds] } },
    orderBy: { riotMatchId: "asc" },
    take: args.riotMatchIds.length,
    select: { riotMatchId: true },
  });
  return rows.map((row) => RiotMatchIdSchema.parse(row.riotMatchId));
}

/**
 * One row of the aggregate, cast down from Postgres's `bigint`.
 *
 * `COUNT` is `bigint`, which the driver hands back as a JavaScript `BigInt` and
 * which no count field in the V2 contracts can carry. The cast is in SQL rather
 * than a conversion here so a count that genuinely overflowed an `int` fails in
 * the database instead of arriving silently truncated — a recovery batch that
 * large is a different problem from the one this machine solves.
 */
const RecoverableCountRowSchema = z.strictObject({
  recoverable: z.int().nonnegative(),
});

/**
 * How many matches the batch has to recover, over its whole range.
 *
 * Deliberately not paged. This is issued once, at the transition into
 * `processing`, and `discovered` is frozen there for the life of the batch; a
 * paged count would be a sum over pages taken at different instants, and the
 * range shrinks between them. One statement is also the only way the number can
 * be a consistent snapshot of anything.
 *
 * Distinct by match rather than by receipt row, because receipt identity
 * includes the version and the scope: one match may legitimately carry more
 * than one `raw-archive-match` row, and counting rows would make `discovered` a
 * number the processing phase could never reach.
 */
export async function countRecoverableMatches(
  db: Db,
  args: { archiveReceiptKind: ReceiptKind; recordedThrough: Date },
): Promise<number> {
  const rows = await db.$queryRaw`
    SELECT COUNT(DISTINCT a."riotMatchId")::int AS "recoverable"
      FROM "MatchProcessingReceipt" AS a
     WHERE a."kind" = ${args.archiveReceiptKind}
       AND a."recordedAt" <= ${args.recordedThrough}
       AND NOT EXISTS (SELECT 1
                         FROM "MatchObservation" AS o
                        WHERE o."riotMatchId" = a."riotMatchId")`;
  // An aggregate with no GROUP BY returns exactly one row; any other shape is
  // this statement having changed under the parse.
  const [row] = z.tuple([RecoverableCountRowSchema]).parse(rows);
  return row.recoverable;
}

/**
 * The front of the remaining work: archived matches still carrying no
 * observation, oldest archive first.
 *
 * The processing phase pages through this without a cursor, and the durable
 * state is what makes that terminate: a match leaves this result the moment its
 * observation is committed, so the next call's page starts where the last one
 * finished. A stored position would be the wrong tool as well as an unnecessary
 * one — the `processing` state has no cursor columns at all, because the count
 * columns replace them, and the tally is what the machine remembers instead.
 *
 * Oldest first so the longest-stranded match is recovered first, with the id
 * breaking ties for the same reason the scan cursor carries it.
 *
 * Rides `MatchProcessingReceipt(kind, recordedAt)` for the outer scan and the
 * observation primary key for the anti-join.
 */
export async function listRecoverableMatches(
  db: Db,
  args: {
    archiveReceiptKind: ReceiptKind;
    recordedThrough: Date;
    limit: number;
  },
): Promise<RiotMatchId[]> {
  const rows = await db.$queryRaw`
    SELECT a."riotMatchId" AS "riotMatchId"
      FROM "MatchProcessingReceipt" AS a
     WHERE a."kind" = ${args.archiveReceiptKind}
       AND a."recordedAt" <= ${args.recordedThrough}
       AND NOT EXISTS (SELECT 1
                         FROM "MatchObservation" AS o
                        WHERE o."riotMatchId" = a."riotMatchId")
     GROUP BY a."riotMatchId"
     ORDER BY MIN(a."recordedAt") ASC, a."riotMatchId" ASC
     LIMIT ${args.limit}::int`;
  return z
    .array(z.strictObject({ riotMatchId: RiotMatchIdSchema }))
    .parse(rows)
    .map((row) => row.riotMatchId);
}
