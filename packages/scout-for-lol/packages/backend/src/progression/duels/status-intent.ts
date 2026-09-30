import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutNotificationV2WorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { Db } from "#src/database/index.ts";
import {
  getSubjectIntent,
  upsertSubjectIntent,
} from "#src/database/durable/intent-repository.ts";
import { requestWorkflowStart } from "#src/database/durable/workflow-start-repository.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import {
  duelStatusAnnouncementCodec,
  type DuelStatusPayload,
} from "#src/progression/duels/status-message.ts";

/** Record a Duel send and its Temporal handoff in the domain transaction. */
export async function mintDuelStatusIntent(
  db: Db,
  args: {
    stage: ScoutStage;
    guildId: string;
    channelId: string;
    dedupeKey: string;
    payload: DuelStatusPayload;
    createdAt: Date;
    freshnessDeadline: Date;
  },
): Promise<void> {
  const guildId = DiscordGuildIdSchema.parse(args.guildId);
  const channelId = DiscordChannelIdSchema.parse(args.channelId);
  const key = NotificationIntentKeySchema.parse(
    `duel-status:${args.dedupeKey}`,
  );
  const announcement = duelStatusAnnouncementCodec.serialize({
    guildId,
    payload: args.payload,
  });
  const standing = await getSubjectIntent(db, { intentKey: key });
  const legacy = await db.duelStatusOutbox.findUnique({
    where: { dedupeKey: args.dedupeKey },
    select: { id: true },
  });
  if (legacy !== null) {
    if (standing !== null) {
      throw new Error(`Duel status ${key} has both legacy and V2 owners`);
    }
    // A pre-cutover producer already made this decision. Its outbox retains
    // ownership across retries and completed sends; never mint a second path.
    return;
  }
  if (standing === null) {
    const created = await upsertSubjectIntent(db, {
      duelId: args.payload.seriesId,
      intent: {
        key,
        kind: "duel-status",
        origin: { kind: "live" },
        target: { kind: "channel", channelId },
        freshnessDeadline: toIsoInstant(args.freshnessDeadline),
        createdAt: toIsoInstant(args.createdAt),
        attemptCount: 0,
        announcement,
        state: { kind: "pending" },
      },
    });
    if (created.outcome === "conflict") {
      throw new Error(`Duel status intent ${key} raced with different facts`);
    }
  } else if (
    !("duelId" in standing) ||
    standing.duelId !== args.payload.seriesId ||
    standing.intent.kind !== "duel-status" ||
    standing.intent.target.kind !== "channel" ||
    standing.intent.target.channelId !== channelId ||
    !Bun.deepEquals(standing.intent.announcement, announcement, true)
  ) {
    throw new Error(`Duel status intent ${key} was reused for different facts`);
  }
  const input = { stage: args.stage, intentKey: key };
  const requested = await requestWorkflowStart(db, {
    requestedWorkflowId: scoutNotificationV2WorkflowId(args.stage, key),
    workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
    requestedBy: null,
    requestSource: `duel-status:${args.payload.kind}`,
    inputPayload: {
      kind: SCOUT_WORKFLOW_NAMES.notificationV2,
      version: 1,
      data: input,
    },
    requestedAt: toIsoInstant(args.createdAt),
  });
  if (requested.outcome === "conflict") {
    throw new Error(
      `Duel status workflow start for ${key} conflicts with existing input`,
    );
  }
}
