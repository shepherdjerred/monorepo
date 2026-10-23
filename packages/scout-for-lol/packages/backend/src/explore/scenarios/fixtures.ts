import {
  ConfirmationIntentPayloadSchema,
  DiscordAccountIdSchema,
  ExploreMessageSchema,
  ReportCreateInputSchema,
  type ExploreMessage,
  type ExploreScenarioCase,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { createConfirmationIntent } from "#src/lib/confirmation-intent/create.ts";
import { CreationPrepareResultSchema } from "#src/explore/creation/schemas.ts";
import {
  scenarioChannelId,
  type ScenarioWorld,
} from "#src/explore/scenarios/world.ts";

/**
 * Writing a scenario world into the scenario database.
 *
 * Everything goes through the same tables the product reads, so a tool sees
 * a seeded player exactly as it would see one added through the web form.
 * Prior turns are returned as the history the agent is handed, carrying the
 * same trace a real creation card leaves behind — which is the only place a
 * card's intent id lives.
 */

/** A small, valid ScoutQL report, so a seeded report is one the product could run. */
export const SCENARIO_REPORT_QUERY =
  "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table";

/** Owns the reports a case marks as not the asker's; never a member of any world. */
const OTHER_REPORT_OWNER = DiscordAccountIdSchema.parse("900999999999999999");

/** Fixed, so every run seeds identical timestamps. */
const SEEDED_AT = new Date("2026-10-01T12:00:00.000Z");

export async function seedScenarioWorld(input: {
  readonly db: ExtendedPrismaClient;
  readonly world: ScenarioWorld;
  readonly entry: ExploreScenarioCase;
  /** The run's clock, for intent expiry relative to "now". */
  readonly now: Date;
}): Promise<{ readonly history: readonly ExploreMessage[] }> {
  const { db, world, entry, now } = input;

  for (const member of world.members) {
    await db.user.upsert({
      where: { discordId: member.id },
      create: { discordId: member.id, discordUsername: member.username },
      update: { discordUsername: member.username },
    });
  }

  await db.guildInstall.upsert({
    where: { serverId: world.guildId },
    create: {
      serverId: world.guildId,
      serverName: world.guildName,
      ownerDiscordId: world.asker.id,
      addedByDiscordId: world.asker.id,
      memberCount: world.members.length,
      installedAt: SEEDED_AT,
    },
    update: { serverName: world.guildName, removedAt: null },
  });

  for (const player of world.players) {
    const stamps = {
      serverId: world.guildId,
      creatorDiscordId: world.asker.id,
      createdTime: SEEDED_AT,
      updatedTime: SEEDED_AT,
    };
    const created = await db.player.create({
      data: {
        alias: player.alias,
        discordId: player.discordId,
        ...stamps,
        accounts: {
          create: {
            alias: player.alias,
            puuid: player.account.puuid,
            region: player.account.region,
            riotGameName: player.account.gameName,
            riotTagLine: player.account.tagLine,
            riotIdUpdatedAt: SEEDED_AT,
            ...stamps,
          },
        },
      },
    });
    for (const channelId of player.feedChannelIds) {
      await db.subscription.create({
        data: { playerId: created.id, channelId, ...stamps },
      });
    }
  }

  const reportIds = new Map<string, number>();
  for (const report of entry.guild.reports) {
    const created = await db.report.create({
      data: {
        serverId: world.guildId,
        ownerId: report.ownedByAsker ? world.asker.id : OTHER_REPORT_OWNER,
        channelId: scenarioChannelId(world, report.channel),
        title: report.title,
        queryText: SCENARIO_REPORT_QUERY,
        cronExpression: "0 12 * * 0",
        scheduleTimezone: "UTC",
        isEnabled: report.enabled,
        createdTime: SEEDED_AT,
        updatedTime: SEEDED_AT,
      },
    });
    reportIds.set(report.title, created.id);
  }

  const history: ExploreMessage[] = [];
  let parentId: string | null = null;
  for (const [index, turn] of entry.priorTurns.entries()) {
    const askedAt = new Date(
      now.getTime() - (entry.priorTurns.length - index) * 120_000,
    );
    const question = ExploreMessageSchema.parse({
      id: globalThis.crypto.randomUUID(),
      role: "user",
      parentId,
      content: turn.question,
      createdAt: askedAt.toISOString(),
    });
    const trace =
      turn.intent === undefined
        ? []
        : [
            await seedPriorIntent({
              db,
              world,
              intent: turn.intent,
              reportIds,
              now,
            }),
          ];
    const answer = ExploreMessageSchema.parse({
      id: globalThis.crypto.randomUUID(),
      role: "assistant",
      parentId: question.id,
      content: turn.answer,
      guildIds: [world.guildId],
      trace,
      createdAt: new Date(askedAt.getTime() + 15_000).toISOString(),
    });
    history.push(question, answer);
    parentId = answer.id;
  }

  return { history };
}

/**
 * A creation card from an earlier turn, in the state the case describes.
 *
 * Minted through the product's own writer, then moved to its state the way
 * the confirm path would leave it: `consumed` carries the created report's id
 * in `resultJson`, exactly what a real confirmation stores.
 */
async function seedPriorIntent(input: {
  readonly db: ExtendedPrismaClient;
  readonly world: ScenarioWorld;
  readonly intent: NonNullable<
    ExploreScenarioCase["priorTurns"][number]["intent"]
  >;
  readonly reportIds: ReadonlyMap<string, number>;
  readonly now: Date;
}) {
  const { db, world, intent, now } = input;
  const report = ReportCreateInputSchema.parse({
    title: intent.reportTitle,
    channelId: scenarioChannelId(world, intent.channel),
    queryText: SCENARIO_REPORT_QUERY,
    cronExpression: "0 12 * * 0",
    scheduleTimezone: "Europe/Athens",
  });
  const payload = ConfirmationIntentPayloadSchema.parse({
    kind: "report",
    guildId: world.guildId,
    ...report,
  });
  const mintedAt = new Date(now.getTime() - 5 * 60_000);
  const expiresAt =
    intent.state === "pending"
      ? new Date(now.getTime() + 5 * 60_000)
      : new Date(
          mintedAt.getTime() +
            10 * 60_000 -
            (intent.state === "expired" ? 20 * 60_000 : 0),
        );
  const created = await createConfirmationIntent(db, {
    serverId: world.guildId,
    actorDiscordId: world.asker.id,
    payload,
    idempotencyKey: `scenario:${world.caseId}:${world.surface}:${intent.reportTitle}`,
    expiresAt,
  });
  if (created.kind !== "intent_created") {
    throw new Error(
      `Scenario ${world.caseId} could not seed its prior intent: ${created.kind}.`,
    );
  }
  if (intent.state === "consumed") {
    const entityId = input.reportIds.get(intent.reportTitle);
    if (entityId === undefined) {
      throw new Error(
        `Scenario ${world.caseId} confirms report '${intent.reportTitle}', which its guild does not seed.`,
      );
    }
    await db.confirmationIntent.update({
      where: { id: created.intent.id },
      data: {
        consumedAt: new Date(mintedAt.getTime() + 30_000),
        resultJson: JSON.stringify({
          kind: "created",
          entity: "report",
          entityId,
          guildId: world.guildId,
        }),
      },
    });
  }

  const output = CreationPrepareResultSchema.parse({
    kind: "creation_confirmation_required",
    message:
      "Nothing has been created yet. Tell the user this is waiting for their confirmation and that the card expires in ten minutes.",
    intent: {
      intentId: created.intent.id,
      kind: "report",
      guildId: world.guildId,
      expiresAt: created.intent.expiresAt.toISOString(),
      summary: `Report "${intent.reportTitle}" in #${intent.channel}`,
    },
  });
  const serialized = JSON.stringify(output);
  return {
    toolCallId: `scenario-${created.intent.id}`,
    toolName: "prepare_report_creation",
    message: "Prepared a report for confirmation",
    status: "succeeded" as const,
    durationMs: 1200,
    details: null,
    rawInput: null,
    rawOutput: {
      kind: "value" as const,
      value: output,
      byteLength: new TextEncoder().encode(serialized).byteLength,
    },
  };
}
