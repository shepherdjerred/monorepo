import {
  NotificationIntentKeySchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutNotificationWorkflowId,
} from "@scout-for-lol/temporal";
import type { Db } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { upsertSubjectIntent } from "#src/database/durable/intent-repository.ts";
import {
  notificationIntentRowToRecord,
  type DareNotificationIntentRecord,
} from "#src/database/durable/intent-row.ts";
import { requestWorkflowStart } from "#src/database/durable/workflow-start-repository.ts";
import { toIsoInstant } from "#src/durable/match/match-identity.ts";
import {
  dareStatusAnnouncementCodec,
  type DareNotificationEventInput,
  type DareResultAnnouncement,
} from "#src/betting/dares/presentation/notify/dare-status-message.ts";

const DARE_STATUS_FRESHNESS_MS = 30 * 24 * 60 * 60 * 1000;

/** Length-delimited so one event key cannot prefix another event's recipients. */
function eventPrefix(deduplicationKey: string): string {
  return `dare-status:${deduplicationKey.length.toString()}:${deduplicationKey}:recipient:`;
}

function assertStandingRecipients(
  rows: readonly unknown[],
  input: DareNotificationEventInput,
): void {
  for (const row of rows) {
    const record = notificationIntentRowToRecord(row);
    if (
      !("dareId" in record) ||
      record.dareId !== input.dareId ||
      record.intent.kind !== "dare-status" ||
      record.intent.target.kind !== "dm"
    ) {
      throw new Error(
        `Dare notification ${input.deduplicationKey} has a different subject`,
      );
    }
  }
}

/** Freeze the event's recipients on its first committed V2 intents. */
export async function mintDareStatusIntents(
  db: Db,
  input: DareNotificationEventInput,
): Promise<void> {
  const prefix = eventPrefix(input.deduplicationKey);
  const legacy = await db.bucksDareNotificationEvent.findUnique({
    where: { deduplicationKey: input.deduplicationKey },
    select: { id: true },
  });
  const standingRows = await db.matchNotificationIntent.findMany({
    where: { intentKey: { startsWith: prefix } },
  });
  if (legacy !== null) {
    if (standingRows.length > 0) {
      throw new Error(
        `Dare notification ${input.deduplicationKey} has legacy and V2 owners`,
      );
    }
    return;
  }
  if (standingRows.length > 0) {
    assertStandingRecipients(standingRows, input);
    // The first committed event owns its payload and recipient set. A replay
    // can derive a different summary after Dare progress advances.
    return;
  }

  const dare = await db.bucksDare.findUniqueOrThrow({
    where: { id: input.dareId },
    select: {
      serverId: true,
      challengerDiscordId: true,
      targets: { select: { discordId: true } },
      contributions: { select: { discordId: true } },
    },
  });
  const guildId = DiscordGuildIdSchema.parse(dare.serverId);
  const announcement = dareStatusAnnouncementCodec.serialize({
    dareId: input.dareId,
    revision: input.revision,
    guildId,
    category: input.category,
    kind: input.kind,
    summary: input.summary,
    ...(input.actorDiscordId === undefined
      ? {}
      : { actorDiscordId: DiscordAccountIdSchema.parse(input.actorDiscordId) }),
    ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
  });
  const recipients = [
    ...new Set([
      dare.challengerDiscordId,
      ...dare.targets.map((target) => target.discordId),
      ...dare.contributions.map((contribution) => contribution.discordId),
    ]),
  ].map((discordId) => DiscordAccountIdSchema.parse(discordId));
  const createdAt = toIsoInstant(input.occurredAt);
  const freshnessDeadline = toIsoInstant(
    new Date(input.occurredAt.getTime() + DARE_STATUS_FRESHNESS_MS),
  );

  for (const accountId of recipients) {
    const key = NotificationIntentKeySchema.parse(`${prefix}${accountId}`);
    const expected: DareNotificationIntentRecord = {
      dareId: input.dareId,
      intent: {
        key,
        kind: "dare-status",
        origin: { kind: "live" },
        target: { kind: "dm", accountId },
        freshnessDeadline,
        createdAt,
        attemptCount: 0,
        announcement,
        state: { kind: "pending" },
      },
    };
    await mintAndStart(db, expected, `dare-status:${input.kind}`);
  }
}

/**
 * Write one Dare intent and request its notification Workflow, in the
 * caller's transaction, so the decision to notify and the request to deliver
 * commit together.
 */
async function mintAndStart(
  db: Db,
  expected: DareNotificationIntentRecord,
  requestSource: string,
): Promise<void> {
  const key = expected.intent.key;
  const created = await upsertSubjectIntent(db, expected);
  if (created.outcome === "conflict") {
    throw new Error(
      `Dare notification intent ${key} raced with different facts`,
    );
  }
  if (created.outcome === "already-applied") return;
  const stage = configuration.temporalNamespace;
  const requested = await requestWorkflowStart(db, {
    requestedWorkflowId: scoutNotificationWorkflowId(stage, key),
    workflowType: SCOUT_WORKFLOW_NAMES.notification,
    requestedBy: null,
    requestSource,
    inputPayload: {
      kind: SCOUT_WORKFLOW_NAMES.notification,
      version: 1,
      data: { stage, intentKey: key },
    },
    requestedAt: expected.intent.createdAt,
  });
  if (requested.outcome === "conflict") {
    throw new Error(`Dare notification workflow start for ${key} conflicts`);
  }
}

/**
 * Mint the public result post a terminal settlement owes the Dare's channel.
 *
 * One per resolved revision, keyed by the Dare and revision alone: the
 * settlement that makes a Dare terminal commits exactly once, so a second
 * mint for the same revision is a replay of the same facts or a broken
 * contract, and `upsertSubjectIntent` tells those apart.
 */
export async function mintDareResultIntent(
  db: Db,
  input: {
    dareId: number;
    revision: number;
    result: DareResultAnnouncement;
    matchId?: RiotMatchId | undefined;
    occurredAt: Date;
  },
): Promise<void> {
  const dare = await db.bucksDare.findUniqueOrThrow({
    where: { id: input.dareId },
    select: { serverId: true, channelId: true },
  });
  const key = NotificationIntentKeySchema.parse(
    `dare-result:${input.dareId.toString()}:revision:${input.revision.toString()}`,
  );
  const kind =
    input.result.resolution === "unachieved"
      ? "failed"
      : input.result.resolution;
  const expected: DareNotificationIntentRecord = {
    dareId: input.dareId,
    intent: {
      key,
      kind: "dare-status",
      origin: { kind: "live" },
      target: {
        kind: "channel",
        channelId: DiscordChannelIdSchema.parse(dare.channelId),
      },
      freshnessDeadline: toIsoInstant(
        new Date(input.occurredAt.getTime() + DARE_STATUS_FRESHNESS_MS),
      ),
      createdAt: toIsoInstant(input.occurredAt),
      attemptCount: 0,
      announcement: dareStatusAnnouncementCodec.serialize({
        dareId: input.dareId,
        revision: input.revision,
        guildId: DiscordGuildIdSchema.parse(dare.serverId),
        category: "lifecycle",
        kind,
        summary: input.result.plainLanguage,
        ...(input.matchId === undefined ? {} : { matchId: input.matchId }),
        result: input.result,
      }),
      state: { kind: "pending" },
    },
  };
  await mintAndStart(db, expected, `dare-result:${input.result.resolution}`);
}
