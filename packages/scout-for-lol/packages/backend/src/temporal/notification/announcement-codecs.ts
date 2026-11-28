import {
  HallBreakRecordsSchema,
  LegacyHallBreakRecordsSchema,
  type HallBreakPayload,
  type LegacyHallBreakPayload,
} from "#src/progression/hall/break-payload.ts";
import { UndeliverableContentError } from "#src/temporal/notification/undeliverable-content.ts";
import {
  defineVersionedCodec,
  VersionedPayloadEnvelopeSchema,
} from "@scout-for-lol/domain/codec/versioned.ts";
import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordGuildIdSchema,
  type DiscordGuildId,
} from "@scout-for-lol/domain/identity/discord.ts";
import { z } from "zod";

const HallAnnouncementBaseSchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  riotMatchId: RiotMatchIdSchema,
});
const wrongMatch = {
  message: "Hall records must belong to the announced match",
};

function recordsBelongToMatch(announcement: {
  riotMatchId: RiotMatchId;
  records: readonly { matchId: RiotMatchId }[];
}): boolean {
  return announcement.records.every(
    (record) => record.matchId === announcement.riotMatchId,
  );
}

const legacyHallRecordBreakAnnouncementCodec = defineVersionedCodec({
  kind: "scout-hall-record-break-announcement",
  version: 1,
  schema: HallAnnouncementBaseSchema.extend({
    records: LegacyHallBreakRecordsSchema,
  }).refine(recordsBelongToMatch, wrongMatch),
});

const currentHallRecordBreakAnnouncementCodec = defineVersionedCodec({
  kind: "scout-hall-record-break-announcement",
  version: 2,
  schema: HallAnnouncementBaseSchema.extend({
    records: HallBreakRecordsSchema,
  }).refine(recordsBelongToMatch, wrongMatch),
});

export type HallRecordBreakAnnouncement = z.infer<
  typeof HallAnnouncementBaseSchema
> & {
  records: (
    | HallBreakPayload
    | (LegacyHallBreakPayload & { previous?: never; standings?: never })
  )[];
};

// V1 never recorded the old score or the standings. Keep that evidence shape
// so pending announcements still render with the data they were minted with.
export const hallRecordBreakAnnouncementCodec = {
  ...currentHallRecordBreakAnnouncementCodec,
  parse(json: unknown): HallRecordBreakAnnouncement {
    const envelope = VersionedPayloadEnvelopeSchema.parse(json);
    return envelope.version === 1
      ? legacyHallRecordBreakAnnouncementCodec.parse(envelope)
      : currentHallRecordBreakAnnouncementCodec.parse(envelope);
  },
};

/** What a minter puts on a `hall-record-break` intent. */
export function hallRecordBreakAnnouncementEnvelope(input: {
  guildId: DiscordGuildId;
  riotMatchId: RiotMatchId;
  records: readonly HallBreakPayload[];
}) {
  return hallRecordBreakAnnouncementCodec.serialize({
    guildId: input.guildId,
    riotMatchId: input.riotMatchId,
    records: [...input.records],
  });
}

/**
 * The announcement payload this intent carries cannot produce its message.
 *
 * The same class of defect as a malformed render receipt, on the other kind of
 * persisted evidence: an announcement-kind intent minted with no payload, one
 * whose envelope fails its codec, or one describing a resolution that has no
 * message to send. All three are fixed at mint and re-read identically
 * forever, so the delivery parks the intent instead of asking reconciliation
 * to re-drive it every sweep.
 */
export class MalformedAnnouncementIntentError extends UndeliverableContentError {
  readonly intentKey: string;

  constructor(args: { intentKey: string; detail: string }) {
    super(
      `The announcement payload on intent ${args.intentKey} cannot produce a message: ${args.detail}`,
    );
    this.name = "MalformedAnnouncementIntentError";
    this.intentKey = args.intentKey;
  }
}
