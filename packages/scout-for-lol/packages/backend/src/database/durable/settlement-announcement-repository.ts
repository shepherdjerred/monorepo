import { z } from "zod";
import { defineVersionedCodec } from "@scout-for-lol/domain/codec/versioned.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import type { Db } from "#src/database/index.ts";

/**
 * The announcement instructions one completed settlement produced.
 *
 * Stored so a takeover can mint from what settlement DID produce instead of
 * re-running a settlement whose steps are one-shot and would return nothing.
 * It attests nothing and nothing derives a fact from it; see the model doc in
 * `schema.prisma` for why a recovery note may carry amounts the attested
 * receipt deliberately refuses.
 *
 * The payload is opaque here on purpose. The instructions are the betting
 * slice's own announcement inputs, already given a shape by the codecs the
 * minter and the delivery arm share, and mirroring them in the persistence
 * layer would be a second definition of the same wire format.
 */
const SettlementAnnouncementPayloadSchema = z.strictObject({
  settlements: z.array(z.unknown()).readonly(),
  dareSummaries: z.array(z.unknown()).readonly(),
});

export type SettlementAnnouncementPayload = z.infer<
  typeof SettlementAnnouncementPayloadSchema
>;

export const settlementAnnouncementCheckpointCodec = defineVersionedCodec({
  kind: "scout-v2-settlement-announcement",
  version: 1,
  schema: SettlementAnnouncementPayloadSchema,
});

/**
 * The row, as the domain sees it. No Prisma type crosses this boundary: the
 * caller receives the parsed payload and the match it belongs to, never the
 * record Prisma returned.
 */
export type SettlementAnnouncementCheckpoint = {
  readonly matchId: RiotMatchId;
  readonly payload: SettlementAnnouncementPayload;
};

/**
 * What one attempt to record a checkpoint did.
 *
 * `conflict` is the case the write-once rule exists for: a standing row whose
 * payload differs is two producers disagreeing about what ONE settlement
 * produced, which cannot both be true. It is reported rather than thrown so
 * the caller decides — the same shape every other durable commit in this lane
 * uses — and the caller here fails the Activity on it.
 */
export type RecordSettlementAnnouncementResult =
  | { outcome: "applied" }
  | { outcome: "already-applied" }
  | { outcome: "conflict"; reason: "settlement-announcement-differs" };

function rowToCheckpoint(row: {
  riotMatchId: string;
  version: number;
  payload: string;
}): SettlementAnnouncementCheckpoint {
  return {
    matchId: RiotMatchIdSchema.parse(row.riotMatchId),
    // The stored envelope carries its own kind and version; the column
    // mirrors the version only so the CHECK and the index can see it.
    payload: settlementAnnouncementCheckpointCodec.parse(
      JSON.parse(row.payload),
    ),
  };
}

/**
 * Record what this settlement produced, at most once.
 *
 * Insert-only. A byte-identical re-presentation is `already-applied`, which is
 * what lets the attempt that crashed between this write and the receipt run
 * again; anything else is a conflict and nothing is overwritten, because the
 * row is the only surviving record of output that cannot be recomputed.
 */
export async function recordSettlementAnnouncementCheckpoint(
  db: Db,
  input: {
    matchId: RiotMatchId;
    payload: SettlementAnnouncementPayload;
  },
): Promise<RecordSettlementAnnouncementResult> {
  const envelope = settlementAnnouncementCheckpointCodec.serialize(
    input.payload,
  );
  const serialized = JSON.stringify(envelope);
  const created = await db.matchSettlementAnnouncement.createMany({
    data: [
      {
        riotMatchId: input.matchId,
        version: envelope.version,
        payload: serialized,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 1) return { outcome: "applied" };
  const existing = await db.matchSettlementAnnouncement.findUnique({
    where: { riotMatchId: input.matchId },
  });
  if (existing === null) {
    throw new Error(
      `The settlement announcement checkpoint for ${input.matchId} was neither inserted nor found; the row vanished between the insert and the read-back`,
    );
  }
  if (
    existing.version === envelope.version &&
    existing.payload === serialized
  ) {
    return { outcome: "already-applied" };
  }
  return { outcome: "conflict", reason: "settlement-announcement-differs" };
}

/** The checkpoint standing for this match, or `null` when none does. */
export async function getSettlementAnnouncementCheckpoint(
  db: Db,
  args: { matchId: RiotMatchId },
): Promise<SettlementAnnouncementCheckpoint | null> {
  const row = await db.matchSettlementAnnouncement.findUnique({
    where: { riotMatchId: args.matchId },
  });
  return row === null ? null : rowToCheckpoint(row);
}
