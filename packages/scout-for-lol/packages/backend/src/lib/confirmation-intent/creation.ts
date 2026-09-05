/**
 * Executing a confirmed creation intent.
 *
 * Everything here runs inside the transaction that claimed the intent, so the
 * claim, the domain write and the audit row commit together or not at all.
 * Each arm calls the *same* service the corresponding web form calls —
 * `createReportInTransaction`, `addSubscription`, `createCompetitionForActor` —
 * so a prepared entity and a hand-filled form produce identical rows and run
 * identical policy. Nothing here re-derives authorization: the caller has
 * already resolved the actor's permissions against the guild on the intent row
 * and passes them in.
 *
 * Policy rejections come back as a discriminated outcome, which the claim
 * helper stores on the intent and replays on a second confirmation. Failures
 * that must not leave a partial entity behind stay exceptions instead, so the
 * caller's transaction rolls back and the intent is left unconsumed.
 */

import type {
  CreationIntentKind,
  CreationIntentPayload,
  DiscordAccountId,
  DiscordGuildId,
  LeaguePuuid,
  PermissionSet,
  Region,
} from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";
import type { AuditDetail } from "#src/lib/audit/audited-mutation.ts";
import { createCompetitionForActor } from "#src/lib/competitions/create.ts";
import { createReportInTransaction } from "#src/lib/reports/create.ts";
import { addSubscription } from "#src/lib/subscription/add.ts";
import type { AddSubscriptionResult } from "#src/lib/subscription/types.ts";

export type CreationIntentOutcome =
  /**
   * The entity exists. `guildId` travels with the id so the confirming client
   * can deep-link without re-reading the intent.
   */
  | {
      kind: "created";
      entity: CreationIntentKind;
      entityId: number;
      guildId: DiscordGuildId;
    }
  /** A per-server or per-owner active-entity limit rejected the request. */
  | { kind: "limit_reached"; message: string }
  /** The report's `queryText` is not compilable ScoutQL. */
  | { kind: "invalid_query"; message: string }
  /** The criteria/game-variant combination is not a valid competition. */
  | { kind: "invalid_configuration"; message: string }
  /** The per-(guild, owner) competition creation rate limit rejected this. */
  | { kind: "rate_limited"; message: string }
  /** `competitions:invite` or `competitions:schedule` is missing. */
  | { kind: "missing_permission"; message: string }
  /** The PUUID is already tracked in this guild under another player. */
  | { kind: "account_already_subscribed"; message: string }
  /** That player is already subscribed in the requested channel. */
  | { kind: "subscription_already_exists"; message: string }
  /** Riot no longer recognises the frozen Riot ID. */
  | { kind: "riot_id_not_found"; message: string };

/**
 * Work that must happen after the transaction commits, described rather than
 * done: a schedule nudge, a rate-limit stamp, and a best-effort Riot backfill
 * all become wrong if the transaction that produced them rolls back.
 */
export type CreationPostCommit =
  | { kind: "report" }
  | { kind: "competition" }
  | {
      kind: "subscription";
      alias: string;
      puuid: LeaguePuuid;
      region: Region;
      discordUserId: DiscordAccountId | undefined;
      /** Whether this is the guild's first subscription (analytics milestone). */
      firstSubscription: boolean;
    };

export type CreationExecution = {
  outcome: CreationIntentOutcome;
  audit: AuditDetail | null;
  postCommit: CreationPostCommit | null;
};

export type ExecuteCreationIntentParams = {
  payload: CreationIntentPayload;
  /** Read off the intent row, never out of the payload. */
  guildId: DiscordGuildId;
  actorDiscordId: DiscordAccountId;
  /** The actor's effective permissions, resolved at confirm time. */
  permissions: PermissionSet;
  /** Operator control, read at confirm time rather than frozen at prepare. */
  initialHistoryImportEnabled: boolean;
};

async function executeReport(
  tx: Db,
  params: ExecuteCreationIntentParams & { payload: { kind: "report" } },
): Promise<CreationExecution> {
  const { payload, guildId, actorDiscordId } = params;
  const result = await createReportInTransaction(tx, {
    serverId: guildId,
    ownerId: actorDiscordId,
    input: payload,
  });
  if (result.kind === "limit_reached") {
    return {
      outcome: { kind: "limit_reached", message: result.reason },
      audit: null,
      postCommit: null,
    };
  }
  if (result.kind === "invalid_query") {
    return {
      outcome: { kind: "invalid_query", message: result.message },
      audit: null,
      postCommit: null,
    };
  }
  return {
    outcome: {
      kind: "created",
      entity: "report",
      entityId: result.report.id,
      guildId,
    },
    audit: {
      action: "REPORT_CREATE",
      targetChannelId: payload.channelId,
      payload: {
        reportId: result.report.id,
        title: payload.title,
        queryText: payload.queryText,
        cronExpression: payload.cronExpression,
        scheduleTimezone: payload.scheduleTimezone,
        isEnabled: payload.isEnabled,
        via: "explore",
      },
    },
    postCommit: { kind: "report" },
  };
}

async function executeCompetition(
  tx: Db,
  params: ExecuteCreationIntentParams & { payload: { kind: "competition" } },
): Promise<CreationExecution> {
  const { payload, guildId, actorDiscordId, permissions } = params;
  const result = await createCompetitionForActor({
    db: tx,
    permissions,
    guildId,
    ownerId: actorDiscordId,
    input: payload,
  });
  if (result.kind !== "created") {
    const outcome: CreationIntentOutcome =
      result.kind === "invalid_configuration"
        ? { kind: "invalid_configuration", message: result.message }
        : result.kind === "rate_limited"
          ? { kind: "rate_limited", message: result.message }
          : result.kind === "limit_reached"
            ? { kind: "limit_reached", message: result.message }
            : { kind: "missing_permission", message: result.message };
    return { outcome, audit: null, postCommit: null };
  }
  return {
    outcome: {
      kind: "created",
      entity: "competition",
      entityId: result.competition.id,
      guildId,
    },
    audit: {
      action: "COMPETITION_CREATE",
      targetChannelId: payload.channelId,
      payload: {
        competitionId: result.competition.id,
        title: payload.title,
        visibility: payload.visibility,
        gameVariant: payload.gameVariant,
        maxParticipants: payload.maxParticipants,
        initialPlayerIds: payload.initialPlayerIds,
        via: "explore",
      },
    },
    postCommit: { kind: "competition" },
  };
}

/**
 * The non-`created` half of a subscription result.
 *
 * `subscription-already-exists` still commits a new Account row, exactly as it
 * does through the web form, so it audits `ACCOUNT_ADD` rather than nothing —
 * a state change without an audit trail is the thing this whole path exists to
 * prevent.
 */
function subscriptionRefusal(
  result: Exclude<
    AddSubscriptionResult,
    { kind: "created" } | { kind: "internal-error" }
  >,
  payload: CreationIntentPayload & { kind: "subscription" },
): CreationExecution {
  if (result.kind === "account-already-subscribed") {
    return {
      outcome: {
        kind: "account_already_subscribed",
        message: `That account is already tracked as ${result.existingPlayerAlias}.`,
      },
      audit: null,
      postCommit: null,
    };
  }
  if (result.kind === "subscription-already-exists") {
    return {
      outcome: {
        kind: "subscription_already_exists",
        message: `${result.playerAlias} is already subscribed in that channel.`,
      },
      audit: {
        action: "ACCOUNT_ADD",
        targetChannelId: payload.channelId,
        targetPlayerId: result.playerId,
        targetAccountId: result.accountId,
        payload: {
          riotId: payload.riotId,
          region: payload.region,
          alias: payload.alias,
          via: "explore",
        },
      },
      // An account row still committed, so it gets the same best-effort
      // match-history backfill `subscription.add` gives this outcome. It is not
      // the guild's first subscription by construction — one already exists in
      // that channel.
      postCommit: {
        kind: "subscription",
        alias: payload.alias,
        puuid: payload.puuid,
        region: payload.region,
        discordUserId: payload.discordUserId,
        firstSubscription: false,
      },
    };
  }
  if (result.kind === "riot-id-not-found") {
    return {
      outcome: { kind: "riot_id_not_found", message: result.message },
      audit: null,
      postCommit: null,
    };
  }
  return {
    outcome: {
      kind: "limit_reached",
      message: `Limit reached: ${result.current.toString()} of ${result.max.toString()}.`,
    },
    audit: null,
    postCommit: null,
  };
}

async function executeSubscription(
  tx: Db,
  params: ExecuteCreationIntentParams & { payload: { kind: "subscription" } },
): Promise<CreationExecution> {
  const { payload, guildId, actorDiscordId, initialHistoryImportEnabled } =
    params;
  const result = await addSubscription(
    {
      guildId,
      channelId: payload.channelId,
      region: payload.region,
      riotId: payload.riotId,
      alias: payload.alias,
      discordUserId: payload.discordUserId,
      creatorDiscordId: actorDiscordId,
      filters: payload.filters ?? null,
    },
    payload.puuid,
    tx,
    initialHistoryImportEnabled,
  );
  // `addSubscription` preserves its public result contract by turning database
  // failures into `internal-error`. Rethrow inside this transaction, exactly as
  // `subscription.add` does, or a rolled-back write would report success.
  if (result.kind === "internal-error") {
    throw new Error(
      `Subscription creation failed for ${payload.alias}: ${result.message}`,
    );
  }
  if (result.kind !== "created") {
    return subscriptionRefusal(result, payload);
  }
  return {
    outcome: {
      kind: "created",
      entity: "subscription",
      entityId: result.subscription.id,
      guildId,
    },
    audit: {
      action: "SUBSCRIPTION_ADD",
      targetChannelId: payload.channelId,
      targetPlayerId: result.player.id,
      targetAccountId: result.account.id,
      payload: {
        riotId: payload.riotId,
        region: payload.region,
        alias: payload.alias,
        isAddingToExistingPlayer: result.isAddingToExistingPlayer,
        via: "explore",
      },
    },
    postCommit: {
      kind: "subscription",
      alias: payload.alias,
      puuid: payload.puuid,
      region: payload.region,
      discordUserId: payload.discordUserId,
      firstSubscription: result.isFirstSubscription,
    },
  };
}

/**
 * Create the entity a confirmed intent describes, inside `tx`.
 *
 * @throws when the competition payload's dates fail `CompetitionDatesSchema`,
 * when its initial roster is invalid, or when the subscription write fails —
 * all cases where the caller's transaction must abort rather than commit a
 * partial entity and a claimed intent.
 */
export async function executeCreationIntent(
  tx: Db,
  params: ExecuteCreationIntentParams,
): Promise<CreationExecution> {
  const { payload } = params;
  if (payload.kind === "report") {
    return await executeReport(tx, { ...params, payload });
  }
  if (payload.kind === "competition") {
    return await executeCompetition(tx, { ...params, payload });
  }
  return await executeSubscription(tx, { ...params, payload });
}
