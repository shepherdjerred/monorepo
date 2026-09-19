import type { Db, ExtendedPrismaClient } from "#src/database/index.ts";
import type { SettlementAnnouncementFamily } from "#src/database/durable/settlement-announcement-repository.ts";
import type { DareSettlementSummary } from "#src/betting/dares/settlement/dare-settle-shared.ts";
import { deliverDareSummaries } from "#src/betting/dares/presentation/notify/dare-delivery.ts";
import { deliverPendingDareNotifications } from "#src/betting/dares/presentation/notify/dare-notification-delivery.ts";

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
 * will be announced; it asks the sink, and the caller supplies one. v1 passes
 * {@link announcingSettlementSink}, which is exactly what it did before this
 * existed. The V2 core passes one built from the match's COMMITTED delivery
 * mode, so a backfilled match gets a sink that announces nothing.
 *
 * ## The rule a sink implements
 *
 * A silent-backfill match posts no new message of any kind and enqueues no
 * delivery: no notification intent, no announcement, no DM, no Dare callout,
 * and no row suggesting a send was intended. It does not suppress edits to
 * messages that already exist — a settled pool's controls are still refreshed
 * and an existing Dare callout is still updated, because those concern
 * messages a live discovery already posted. Settlement itself still runs in
 * full; only the announcing does not.
 *
 * "No new messages, edits fine" is one rule rather than a list of paths, which
 * matters because a path nobody enumerated decides itself under it.
 */
export type SettlementAnnouncementSink = {
  /**
   * Deliver the summaries a PARTIAL settlement committed before it failed.
   *
   * These are one-shot: `settleDaresForMatch` returns a summary only for the
   * transition that committed it, so a retry cannot reproduce them and losing
   * them leaves an already-terminal Dare with nothing to announce, ever. v1
   * therefore delivers them from inside the failure path before rethrowing.
   */
  readonly deliverPartialDareSummaries: (
    summaries: readonly DareSettlementSummary[],
    prismaClient: ExtendedPrismaClient,
  ) => Promise<void>;

  /**
   * Drain the Dare notification outbox.
   *
   * This sends DMs to the challenger, the targets and every contributor, from
   * rows enqueued inside the settling transaction moments earlier. It is a new
   * public delivery, not a refresh, and it is the most private of them.
   */
  readonly drainDareNotifications: (
    prismaClient: ExtendedPrismaClient,
  ) => Promise<void>;

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
 * What v1 does, and has always done: announce everything, immediately.
 *
 * The default everywhere, so a caller that knows nothing about delivery modes
 * behaves exactly as it did before the sink existed.
 */
export const announcingSettlementSink: SettlementAnnouncementSink = {
  deliverPartialDareSummaries: async (summaries, prismaClient) => {
    await deliverDareSummaries(summaries, prismaClient);
  },
  drainDareNotifications: async (prismaClient) => {
    await deliverPendingDareNotifications(prismaClient);
  },
  mayPostDareCallout: () => true,
  // v1 announces from this call stack; there is nothing to recover.
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
  deliverPartialDareSummaries: () => Promise.resolve(),
  drainDareNotifications: () => Promise.resolve(),
  mayPostDareCallout: () => false,
  // Nothing may be announced, so nothing is recorded to announce later.
  recordAnnouncementItem: () => Promise.resolve(),
};
