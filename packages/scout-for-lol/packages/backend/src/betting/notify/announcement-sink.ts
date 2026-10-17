import type { Db } from "#src/database/index.ts";
import type { SettlementAnnouncementFamily } from "#src/database/durable/settlement-announcement-repository.ts";

/**
 * A settlement could not record the durable instruction to announce what it
 * just produced, so the transaction that produced it rolled back.
 *
 * ## Why this is its own class
 *
 * Settlement's callers already catch broadly, and for good reason: one guild's
 * corrupt pool must not cost every other guild its settlement. Those handlers
 * were written when the only thing a pool could do was fail in isolation, and
 * they answer by logging, paging and continuing.
 *
 * Checkpointing broke that assumption. A checkpoint failure is not one pool's
 * misfortune, it is this match's settlement failing to become recoverable, and
 * a handler that absorbs it lets the caller record a settlement receipt over a
 * pool whose bettors were never paid — which no retry then revisits, because
 * the receipt says the effect is done. So the failure carries a type its
 * callers can recognise, and every broad handler between here and the Activity
 * rethrows it explicitly.
 *
 * The rule this encodes, which has now cost this program three findings: when
 * a function acquires a new failure mode, its existing catches silently
 * acquire a meaning nobody chose. Give the new mode a name the old handlers
 * can be taught, rather than hoping they were written for it.
 */
export class SettlementCheckpointError extends Error {
  readonly family: SettlementAnnouncementFamily;
  readonly itemKey: string;
  /**
   * Whether re-running the Activity could plausibly succeed.
   *
   * False means two producers disagree about what ONE settlement produced,
   * which is drift no retry resolves; the Activity surfaces that as a
   * non-retryable failure rather than looping on it.
   */
  readonly retryable: boolean;

  constructor(input: {
    family: SettlementAnnouncementFamily;
    itemKey: string;
    retryable: boolean;
    message: string;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "SettlementCheckpointError";
    this.family = input.family;
    this.itemKey = input.itemKey;
    this.retryable = input.retryable;
  }
}

/**
 * The checkpoint failure inside this error, if there is one.
 *
 * Not every handler between the sink and the Activity rethrows the original:
 * the Dare batch collects the first per-dare failure and reports it as a
 * `DarePartialSettlementError` so the summaries that DID commit are not
 * discarded, which is correct and must stay. A plain `instanceof` at the
 * Activity boundary would then miss a checkpoint conflict arriving inside
 * that wrapper and retry a failure no retry resolves.
 *
 * Bounded rather than recursive without limit: the chain is a handful of
 * links by construction, and a depth cap means a self-referential `cause`
 * cannot hang the settlement path.
 */
export function checkpointFailureIn(
  error: unknown,
): SettlementCheckpointError | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (current instanceof SettlementCheckpointError) return current;
    if (!(current instanceof Error)) return undefined;
    current = current.cause;
  }
  return undefined;
}

/**
 * Who, if anyone, may announce what a settlement produced.
 *
 * Settlement moves money and then tells people about it, and those are
 * separate concerns that this repository had fused: the announcing was hard
 * coded into the settling. A silent-backfill match must still settle in full
 * — balances move whether or not anyone is told — while announcing nothing,
 * and there was no seam at which to say so, so four different paths announced
 * regardless.
 *
 * The sink is that seam. The settlement code no longer knows whether anything
 * will be announced; it asks the sink, and the caller supplies one. Callers
 * with no delivery mode of their own default to
 * {@link announcingSettlementSink}. The V2 core passes one built from the
 * match's COMMITTED delivery mode, so a backfilled match gets a sink that
 * announces nothing.
 *
 * ## The rule a sink implements
 *
 * A silent-backfill match posts no new message of any kind, enqueues no
 * delivery, AND LEAVES NOTHING PENDING THAT A LATER RUN WILL POST: no
 * notification intent, no announcement, no DM, no Dare callout, no row
 * suggesting a send was intended, and no durable flag marking a send as still
 * owed. It does not suppress edits to messages that already exist — a settled
 * pool's controls are still refreshed and an existing Dare callout is still
 * updated, because those concern messages a live discovery already posted.
 * Settlement itself still runs in full; only the announcing does not.
 *
 * "No new messages, edits fine" is one rule rather than a list of paths, which
 * matters because a path nobody enumerated decides itself under it.
 *
 * ## Why deferral is named explicitly
 *
 * The third clause was learned three times, each time from a path that DID
 * withhold its send and still ended in a public message. Delivery rows were
 * enqueued inside the settling transaction and drained by a later run. A
 * Dare's `calloutRefreshPending` was left set and serviced by a later scan,
 * by a poller that had never heard of delivery modes. In both, the suppressed
 * call was the one looking at the sink, and the work outlived it.
 *
 * So the rule is about the STATE a silent settlement leaves behind, not about
 * the call that happens to be executing. Withholding a send suppresses
 * nothing if the instruction to send survives for someone else to act on; ask
 * of every new path not only "does this post?" but "does this leave work that
 * will post?".
 */
export type SettlementAnnouncementSink = {
  /**
   * Whether this settlement may mint its Dare notification intents at all.
   *
   * The `dare-status` intents — DMs to the challenger, the targets and every
   * contributor, and the Dare's channel result post — are minted inside the
   * settling transaction together with their Workflow start requests, and the
   * notification lane delivers them from there. A minted intent is durable
   * work that reconciliation will drive whoever is running, so the only
   * durable suppression is the intent never being written.
   *
   * Asked inside the settling transaction, so the decision and the settlement
   * commit together.
   */
  readonly mayEnqueueDareNotification: () => boolean;

  /**
   * Whether a Dare that has no callout yet may have one POSTED.
   *
   * The callout refresh both posts and edits depending on whether a message
   * reference already exists, so it cannot be suppressed wholesale: withholding
   * the edit would leave already-public callouts stale and wrong, which is a
   * different harm rather than a smaller one. Only the post branch asks.
   */
  readonly mayPostDareCallout: () => boolean;

  /**
   * Record, DURABLY and inside the caller's own transaction, an instruction to
   * announce one thing this settlement just produced.
   *
   * The transaction handle is the whole point. Settlement's results are
   * one-shot — each step returns a summary only for the transition that
   * committed it — so an instruction written after the transaction can be lost
   * in the gap, and a retry cannot rebuild it. Written inside, the item and
   * the instruction commit together or neither does.
   *
   * v1 records nothing: it announces immediately from the same call stack, so
   * it has nothing to recover and no takeover to hand anything to.
   */
  readonly recordAnnouncementItem: (
    db: Db,
    item: {
      family: SettlementAnnouncementFamily;
      itemKey: string;
      payload: unknown;
    },
  ) => Promise<void>;
};

/**
 * Announce everything: post what settles now, and mint every Dare
 * notification as a durable `dare-status` intent for the notification lane.
 *
 * The default everywhere, so a caller that knows nothing about delivery modes
 * announces what it settles. Nothing here sends a Dare DM itself; the intents
 * minted in the settling transaction are the whole hand-off.
 */
export const announcingSettlementSink: SettlementAnnouncementSink = {
  mayEnqueueDareNotification: () => true,
  mayPostDareCallout: () => true,
  // This sink announces from its own call stack; there is nothing to recover.
  recordAnnouncementItem: () => Promise.resolve(),
};

/**
 * A sink for a match that is owed no public delivery.
 *
 * Every announcing path is withheld and nothing is enqueued, so no row later
 * suggests a send was intended. The settlement itself is untouched: it runs,
 * commits and returns exactly as it would for a live match.
 */
export const silentSettlementSink: SettlementAnnouncementSink = {
  mayEnqueueDareNotification: () => false,
  mayPostDareCallout: () => false,
  // Nothing may be announced, so nothing is recorded to announce later.
  recordAnnouncementItem: () => Promise.resolve(),
};

/**
 * Record one announcement instruction through a sink, with the caller's own
 * transaction handle.
 *
 * A one-liner at the call site on purpose: these calls sit inside settlement
 * transactions that are already long, and the reasoning belongs with
 * {@link SettlementAnnouncementSink.recordAnnouncementItem} rather than
 * repeated at each of them.
 */
export async function recordAnnouncement(input: {
  sink: SettlementAnnouncementSink;
  db: Db;
  family: SettlementAnnouncementFamily;
  itemKey: string;
  payload: unknown;
}): Promise<void> {
  await input.sink.recordAnnouncementItem(input.db, {
    family: input.family,
    itemKey: input.itemKey,
    payload: input.payload,
  });
}
