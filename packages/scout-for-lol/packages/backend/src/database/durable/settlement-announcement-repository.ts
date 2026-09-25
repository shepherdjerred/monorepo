import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import type { Db } from "#src/database/index.ts";

/**
 * One item a completed settlement produced, stored so a takeover can announce
 * it without re-running a settlement whose steps are one-shot.
 *
 * A row is written INSIDE the transaction that produces its item, so the item
 * and the instruction to announce it commit together or not at all. That is
 * what distinguishes this from a note written afterwards, which can always be
 * lost in the gap between the commit and the note.
 *
 * The payload is opaque here on purpose. What a `settlement` item means is the
 * betting slice's own summary shape, and mirroring five of those in the
 * persistence layer would be a second definition of each. The notification
 * module owns the parsing; this module owns durability and the write-once rule.
 */
export const SETTLEMENT_ANNOUNCEMENT_FAMILIES = [
  "closure",
  "settlement",
  "parlay",
  "earnings",
  "late-earnings",
  "dare-summary",
] as const;

export type SettlementAnnouncementFamily =
  (typeof SETTLEMENT_ANNOUNCEMENT_FAMILIES)[number];

export const SettlementAnnouncementFamilySchema = z.enum(
  SETTLEMENT_ANNOUNCEMENT_FAMILIES,
);

/** One stored instruction: its family, which item it is, and its body. */
export type SettlementAnnouncementItem = {
  readonly family: SettlementAnnouncementFamily;
  /** The item's identity within its family: a guild id, or a Dare id. */
  readonly itemKey: string;
  readonly payload: unknown;
};

const settlementAnnouncementItemCodec = defineVersionedCodec({
  kind: "scout-v2-settlement-announcement",
  version: 1,
  schema: z.unknown(),
});

/**
 * What one attempt to record an item did.
 *
 * `conflict` is the case the write-once rule exists for: a standing row whose
 * payload differs is two producers disagreeing about what ONE transition
 * produced, which cannot both be true. It is reported rather than thrown, the
 * shape every durable commit in this lane uses, and the caller decides.
 */
export type RecordSettlementAnnouncementResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "settlement-announcement-differs" };

/**
 * Record one item, at most once.
 *
 * Insert-only. A byte-identical re-presentation is `already-applied`, which is
 * what lets a retried transaction proceed; anything else is a conflict and
 * nothing is overwritten, because the row is the only surviving record of a
 * result no retry can recompute.
 *
 * Takes whatever client the caller holds, and that is the point: the producing
 * step passes its own transaction handle, so this row commits with its item.
 */
export async function recordSettlementAnnouncementItem(
  db: Db,
  input: { matchId: RiotMatchId; item: SettlementAnnouncementItem },
): Promise<RecordSettlementAnnouncementResult> {
  const envelope = settlementAnnouncementItemCodec.serialize(
    input.item.payload,
  );
  const serialized = JSON.stringify(envelope);
  const identity = {
    riotMatchId: input.matchId,
    family: input.item.family,
    itemKey: input.item.itemKey,
  };
  const created = await db.matchSettlementAnnouncement.createMany({
    data: [{ ...identity, version: envelope.version, payload: serialized }],
    skipDuplicates: true,
  });
  if (created.count === 1) return { outcome: "applied" };
  const existing = await db.matchSettlementAnnouncement.findUnique({
    where: { riotMatchId_family_itemKey: identity },
  });
  if (existing === null) {
    throw new Error(
      `The settlement announcement for ${input.matchId} (${input.item.family}/${input.item.itemKey}) was neither inserted nor found; the row vanished between the insert and the read-back`,
    );
  }
  return existing.payload === serialized
    ? { outcome: "already-applied" }
    : { outcome: "conflict", reason: "settlement-announcement-differs" };
}

/**
 * Every instruction standing for this match, in a stable order.
 *
 * Ordered by family then item so a recovered fold is deterministic. The live
 * fold sees settlement's own ordering; a recovery that varied between runs
 * could announce the same match differently twice.
 */
export async function listSettlementAnnouncementItems(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<readonly SettlementAnnouncementItem[]> {
  const rows = await db.matchSettlementAnnouncement.findMany({
    where: { riotMatchId: args.matchId },
    orderBy: [{ family: "asc" }, { itemKey: "asc" }],
  });
  return rows.map((row) => ({
    family: SettlementAnnouncementFamilySchema.parse(row.family),
    itemKey: row.itemKey,
    payload: settlementAnnouncementItemCodec.parse(JSON.parse(row.payload)),
  }));
}
