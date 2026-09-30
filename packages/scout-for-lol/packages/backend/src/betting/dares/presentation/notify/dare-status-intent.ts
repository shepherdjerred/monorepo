import { NotificationIntentKeySchema } from "@scout-for-lol/domain/identity/brands.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutNotificationV2WorkflowId,
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

  const dare = await db.bucksDareV2.findUniqueOrThrow({
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
  const stage = configuration.temporalNamespace;
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
    const created = await upsertSubjectIntent(db, expected);
    if (created.outcome === "conflict") {
      throw new Error(
        `Dare notification intent ${key} raced with different facts`,
      );
    }
    if (created.outcome === "already-applied") continue;
    const requested = await requestWorkflowStart(db, {
      requestedWorkflowId: scoutNotificationV2WorkflowId(stage, key),
      workflowType: SCOUT_WORKFLOW_NAMES.notificationV2,
      requestedBy: null,
      requestSource: `dare-status:${input.kind}`,
      inputPayload: {
        kind: SCOUT_WORKFLOW_NAMES.notificationV2,
        version: 1,
        data: { stage, intentKey: key },
      },
      requestedAt: createdAt,
    });
    if (requested.outcome === "conflict") {
      throw new Error(`Dare notification workflow start for ${key} conflicts`);
    }
  }
}
