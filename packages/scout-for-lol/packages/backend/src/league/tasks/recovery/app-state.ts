import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { getErrorMessage } from "#src/utils/errors.ts";

const BOT_STATE_ID = 1;

export async function getLastSuccessfulPollAt(): Promise<Date | undefined> {
  const row = await prisma.botState.findUnique({
    where: { id: BOT_STATE_ID },
  });
  return row?.lastSuccessfulPollAt ?? undefined;
}

export async function setLastSuccessfulPollAt(date: Date): Promise<void> {
  await prisma.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: { lastSuccessfulPollAt: date },
    create: { id: BOT_STATE_ID, lastSuccessfulPollAt: date },
  });
}

export async function getReconciliationCompletedAt(): Promise<
  Date | undefined
> {
  const row = await prisma.botState.findUnique({
    where: { id: BOT_STATE_ID },
  });
  return row?.reconciliationCompletedAt ?? undefined;
}

export async function setReconciliationCompletedAt(date: Date): Promise<void> {
  await prisma.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: { reconciliationCompletedAt: date },
    create: { id: BOT_STATE_ID, reconciliationCompletedAt: date },
  });
}

/** The columns that open a poll: the state `pollStatus: "running"` implies. */
function pollOpening(startedAt: Date) {
  return {
    pollStartedAt: startedAt,
    pollCompletedAt: null,
    pollEvidenceComplete: null,
    pollFailureReason: null,
    pollStatus: "running",
  };
}

/**
 * Open the post-match poll unconditionally — v1's own start, which overwrites
 * whatever poll status stands. v1 serializes its polls in-process and through
 * its Schedule's overlap policy, so it has never needed the row to refuse it.
 */
export async function markPostMatchPollStarted(
  startedAt: Date,
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  await prismaClient.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: pollOpening(startedAt),
    create: { id: BOT_STATE_ID, ...pollOpening(startedAt) },
  });
}

/**
 * How long a claimed poll may stand before another claimant may take it over.
 *
 * A V2 discovery holds its claim from the discovery Activity through the
 * children it awaits and into maintenance, and that is a durable Workflow
 * span, not a process's: a worker that dies mid-run is replaced from history,
 * the children keep running, and maintenance still releases the claim. So
 * only a run that was TERMINATED — by an operator, or by an exhausted
 * maintenance retry with the database unreachable — leaves a claim standing,
 * and the threshold is the safety valve for that case rather than a bound on
 * an ordinary run. It is deliberately much longer than the five-minute
 * in-process valve v1's poll uses, which guards one Activity's span: a false
 * takeover of a live run fails that run's maintenance loudly at the close.
 */
export const POST_MATCH_POLL_STALE_AFTER_MS = 30 * 60 * 1000;

/**
 * Who holds the poll: the instant it was claimed at, which every later write
 * by the holder must present. The instant is the identity because it is the
 * one value both the claim and the close already carry; a claim that lost it
 * cannot close anything.
 */
export type PostMatchPollOwner = { readonly startedAt: Date };

export type PostMatchPollClaim =
  | { outcome: "claimed"; owner: PostMatchPollOwner }
  | { outcome: "held"; since: Date | null };

/**
 * Open the post-match poll only if no live poll holds it.
 *
 * One guarded statement: the update applies unless the row says a poll is
 * running AND that poll started within {@link POST_MATCH_POLL_STALE_AFTER_MS}.
 * A row that does not exist yet is created, and a rival that created it first
 * sends this attempt back through the same guard, so exactly one of two
 * concurrent claimants opens the poll and the other is told who holds it.
 *
 * The guard is spelled as an explicit OR of the claimable cases rather than as
 * the negation of "held", because the negation is not null-safe: a row that
 * said `running` with no `pollStartedAt` would compare NULL against the
 * staleness bound, and `NOT (running AND NULL)` is NULL, so no claimant would
 * ever take it and the poll would wedge permanently. Spelled out, a running
 * poll with no start instant has no identity anyone could close it by, and is
 * therefore claimable — the only answer that can recover.
 *
 * A running poll whose instant is EXACTLY the one being claimed is claimable
 * too, because it is the same claim: the caller is re-presenting an identity
 * it already holds. That is what makes a retried discovery Activity work. The
 * Activity's first-scheduled timestamp is stable across its attempts, so an
 * attempt that claimed the poll and then died leaves a claim its own retry
 * re-acquires, instead of one the retry reads as another run's and skips for —
 * which would strand the poll until the staleness bound with no run left to
 * close it.
 *
 * This is what lets poll ownership span a discovery Workflow's whole run —
 * discovery, the children it awaits, and the maintenance that closes it —
 * rather than the discovery Activity alone. An in-process flag released when
 * that Activity returns left a second run free to open a poll of its own,
 * after which the first run's maintenance closed the SECOND run's poll
 * underneath it.
 */
export async function claimPostMatchPoll(
  input: { startedAt: Date; staleAfterMs?: number },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<PostMatchPollClaim> {
  const staleAfterMs = input.staleAfterMs ?? POST_MATCH_POLL_STALE_AFTER_MS;
  const staleBefore = new Date(input.startedAt.getTime() - staleAfterMs);
  const holdableWhere = {
    id: BOT_STATE_ID,
    OR: [
      { pollStatus: { not: "running" } },
      { pollStartedAt: null },
      { pollStartedAt: { lt: staleBefore } },
      { pollStartedAt: input.startedAt },
    ],
  };
  const owner: PostMatchPollOwner = { startedAt: input.startedAt };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const claimed = await prismaClient.botState.updateMany({
      where: holdableWhere,
      data: pollOpening(input.startedAt),
    });
    if (claimed.count === 1) return { outcome: "claimed", owner };
    const standing = await prismaClient.botState.findUnique({
      where: { id: BOT_STATE_ID },
    });
    if (standing !== null) {
      return { outcome: "held", since: standing.pollStartedAt };
    }
    const created = await prismaClient.botState.createMany({
      data: [{ id: BOT_STATE_ID, ...pollOpening(input.startedAt) }],
      skipDuplicates: true,
    });
    if (created.count === 1) return { outcome: "claimed", owner };
    // A rival created the row between the update and the insert; the next
    // pass reads what they wrote through the same guard.
  }
  throw new Error(
    "Could not claim the post-match poll: the BotState row kept changing under both the update and the insert",
  );
}

/**
 * A poll write presented by a holder the row no longer names.
 *
 * Thrown rather than returned because it is a durable-write conflict: the
 * caller's poll was closed or taken over by someone else, and reporting the
 * close as done would let the run claim an effect that landed on another
 * run's poll. Retrying cannot help — the identity is gone — so the Activity
 * boundary marks it non-retryable.
 */
export class PostMatchPollOwnershipError extends Error {
  constructor(args: { write: string; owner: PostMatchPollOwner }) {
    super(
      `Refusing to ${args.write} the post-match poll claimed at ${args.owner.startedAt.toISOString()}: the row no longer names that poll as the running one, so another run has closed or taken it over`,
    );
    this.name = "PostMatchPollOwnershipError";
  }
}

/**
 * Close the poll as one guarded update, applied only while the row still
 * names `owner`'s poll as the running one.
 */
async function closeOwnedPoll(
  prismaClient: ExtendedPrismaClient,
  owner: PostMatchPollOwner,
  write: string,
  data: Parameters<ExtendedPrismaClient["botState"]["updateMany"]>[0]["data"],
): Promise<void> {
  const closed = await prismaClient.botState.updateMany({
    where: {
      id: BOT_STATE_ID,
      pollStatus: "running",
      pollStartedAt: owner.startedAt,
    },
    data,
  });
  if (closed.count !== 1) {
    throw new PostMatchPollOwnershipError({ write, owner });
  }
}

function pollCompletion(input: {
  completedAt: Date;
  evidenceComplete: boolean;
  evidenceWatermark?: Date | undefined;
}) {
  return {
    ...(input.evidenceComplete
      ? { lastSuccessfulPollAt: input.completedAt }
      : {}),
    pollCompletedAt: input.completedAt,
    pollEvidenceComplete: input.evidenceComplete,
    evidenceWatermarkAt: input.evidenceWatermark ?? null,
    pollFailureReason: input.evidenceComplete
      ? null
      : "Match discovery evidence was incomplete.",
    pollStatus: input.evidenceComplete ? "healthy" : "incomplete",
  };
}

/**
 * Close the poll as completed. With an `owner`, only that owner's running
 * poll is closed and any other standing state is a
 * {@link PostMatchPollOwnershipError}; without one — v1's close — whatever
 * stands is overwritten, as it always has been.
 */
export async function markPostMatchPollCompleted(
  input: {
    completedAt: Date;
    evidenceComplete: boolean;
    evidenceWatermark?: Date | undefined;
    owner?: PostMatchPollOwner | undefined;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<void> {
  const completion = pollCompletion(input);
  if (input.owner !== undefined) {
    await closeOwnedPoll(prismaClient, input.owner, "complete", completion);
    return;
  }
  await prismaClient.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: completion,
    create: { id: BOT_STATE_ID, ...completion },
  });
}

function pollFailure(error: unknown, failedAt: Date) {
  return {
    pollCompletedAt: failedAt,
    pollEvidenceComplete: false,
    pollFailureReason: getErrorMessage(error),
    pollStatus: "failed",
  };
}

/** Close the poll as failed; the `owner` rule is {@link markPostMatchPollCompleted}'s. */
export async function markPostMatchPollFailed(
  error: unknown,
  failedAt: Date,
  options: {
    owner?: PostMatchPollOwner | undefined;
    prismaClient?: ExtendedPrismaClient;
  } = {},
): Promise<void> {
  const prismaClient = options.prismaClient ?? prisma;
  const failure = pollFailure(error, failedAt);
  if (options.owner !== undefined) {
    await closeOwnedPoll(prismaClient, options.owner, "fail", failure);
    return;
  }
  await prismaClient.botState.upsert({
    where: { id: BOT_STATE_ID },
    update: failure,
    create: { id: BOT_STATE_ID, ...failure },
  });
}
