import {
  DUEL_DISCLOSURE_VERSION,
  DiscordChannelIdSchema,
  DuelBestOfSchema,
  DuelEventFormatSchema,
  DuelRulesetV1Schema,
  createEliminationFirstRound,
  seedDuelEntrants,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type DuelBestOf,
  type DuelEventFormat,
  type DuelRulesetV1,
  type DuelSeedMethod,
} from "@scout-for-lol/data";
import {
  scoutDuelSeriesWorkflowId,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { duelSeriesParticipantsCreateData } from "#src/progression/duels/competitors.ts";

export type DuelEventCreate = {
  readonly guildId: DiscordGuildId;
  readonly name: string;
  readonly format: Exclude<DuelEventFormat, "direct">;
  readonly competitorKind: "player" | "pair";
  readonly bestOf: DuelBestOf;
  readonly ruleset: DuelRulesetV1;
  readonly registrationMode: "open" | "invitations";
  readonly seedMethod: DuelSeedMethod;
  readonly matchWindowHours: number;
  readonly channelId: DiscordChannelId;
  readonly organizerDiscordId: DiscordAccountId;
  readonly registrationClosesAt?: Date;
  readonly roundOverrides: readonly {
    readonly roundNumber: number;
    readonly bestOf: DuelBestOf;
  }[];
};

function assertEventLimits(
  format: Exclude<DuelEventFormat, "direct">,
  count: number,
) {
  const maximum = format === "round_robin" ? 16 : 64;
  if (count < 2 || count > maximum) {
    throw new Error(
      `${format === "round_robin" ? "Round-robin" : "Elimination"} events require between 2 and ${maximum.toString()} entrants`,
    );
  }
}

function validateMatchWindow(hours: number): number {
  if (!Number.isInteger(hours) || hours < 24 || hours > 336) {
    throw new Error("A match window must be between 24 hours and 14 days");
  }
  return hours;
}

export async function createDuelEvent(
  db: ExtendedPrismaClient,
  options: DuelEventCreate,
) {
  const format = DuelEventFormatSchema.exclude(["direct"]).parse(
    options.format,
  );
  const bestOf = DuelBestOfSchema.parse(options.bestOf);
  const ruleset = DuelRulesetV1Schema.parse(options.ruleset);
  const matchWindowHours = validateMatchWindow(options.matchWindowHours);
  if (
    options.registrationClosesAt !== undefined &&
    options.registrationClosesAt <= new Date()
  ) {
    throw new Error("Registration must close in the future");
  }
  return await db.duelEvent.create({
    data: {
      guildId: options.guildId,
      name: options.name,
      format,
      competitorKind: options.competitorKind,
      bestOf,
      rulesetJson: JSON.stringify(ruleset),
      registrationMode: options.registrationMode,
      seedMethod: options.seedMethod,
      randomSeed: crypto.randomUUID(),
      matchWindowHours,
      channelId: options.channelId,
      organizerDiscordId: options.organizerDiscordId,
      eventState: "registration_open",
      registrationClosesAt: options.registrationClosesAt ?? null,
      roundOverrides: {
        create: options.roundOverrides.map((override) => ({
          roundNumber: override.roundNumber,
          bestOf: DuelBestOfSchema.parse(override.bestOf),
        })),
      },
    },
  });
}

type StartedSeries = {
  readonly seriesId: string;
  readonly deadlineAt: Date;
};

function seriesCreateData(options: {
  readonly event: {
    readonly id: string;
    readonly guildId: string;
    readonly bestOf: number;
    readonly rulesetJson: string;
    readonly channelId: string;
    readonly organizerDiscordId: string;
    readonly matchWindowHours: number;
  };
  readonly first: {
    readonly competitorId: string;
    readonly competitor: {
      readonly members: readonly {
        readonly playerId: number;
        readonly discordId: string;
      }[];
    };
  };
  readonly second: {
    readonly competitorId: string;
    readonly competitor: {
      readonly members: readonly {
        readonly playerId: number;
        readonly discordId: string;
      }[];
    };
  };
  readonly roundNumber: number;
  readonly position: number;
  readonly bracket: string;
  readonly bestOf: DuelBestOf;
  readonly stage: ScoutStage;
  readonly deadlineAt: Date;
}) {
  const seriesId = crypto.randomUUID();
  return {
    id: seriesId,
    guildId: options.event.guildId,
    eventId: options.event.id,
    roundNumber: options.roundNumber,
    bracket: options.bracket,
    position: options.position,
    competitorOneId: options.first.competitorId,
    competitorTwoId: options.second.competitorId,
    bestOf: options.bestOf,
    rulesetJson: options.event.rulesetJson,
    seriesState: "awaiting_readiness",
    channelId: DiscordChannelIdSchema.parse(options.event.channelId),
    organizerDiscordId: options.event.organizerDiscordId,
    windowStartsAt: new Date(),
    deadlineAt: options.deadlineAt,
    workflowId: scoutDuelSeriesWorkflowId(options.stage, seriesId),
    participants: {
      create: duelSeriesParticipantsCreateData([options.first, options.second]),
    },
  };
}

function roundRobinPairs<T>(entrants: readonly T[]): [T, T][] {
  const pairs: [T, T][] = [];
  for (let first = 0; first < entrants.length; first++) {
    for (let second = first + 1; second < entrants.length; second++) {
      const left = entrants[first];
      const right = entrants[second];
      if (left !== undefined && right !== undefined) pairs.push([left, right]);
    }
  }
  return pairs;
}

function parseDuelSeedMethod(seedMethod: string): DuelSeedMethod {
  switch (seedMethod) {
    case "manual":
    case "random":
    case "rolling_record":
      return seedMethod;
    default:
      throw new Error(`Unknown duel seed method ${seedMethod}`);
  }
}

function duelSeedSourceIds(options: {
  readonly seedMethod: DuelSeedMethod;
  readonly manualOrder: readonly string[] | undefined;
  readonly entrantIds: readonly string[];
}): string[] {
  if (options.seedMethod !== "manual") return [...options.entrantIds];
  const sourceIds = [...(options.manualOrder ?? [])];
  const entrantIdSet = new Set(options.entrantIds);
  if (
    sourceIds.length !== options.entrantIds.length ||
    sourceIds.some((id) => !entrantIdSet.has(id)) ||
    new Set(sourceIds).size !== sourceIds.length
  ) {
    throw new Error(
      "Manual seeding must list every accepted entrant exactly once",
    );
  }
  return sourceIds;
}

type OpeningPairing = {
  readonly first: string;
  readonly second: string;
  readonly position: number;
  readonly bracket: "round_robin" | "winners";
};

function openingPairings(
  format: Exclude<DuelEventFormat, "direct">,
  seededIds: readonly string[],
): OpeningPairing[] {
  if (format === "round_robin") {
    return roundRobinPairs(seededIds).map(([first, second], position) => ({
      first,
      second,
      position,
      bracket: "round_robin",
    }));
  }
  return createEliminationFirstRound(seededIds).flatMap((pairing) =>
    pairing.firstEntrantId === null || pairing.secondEntrantId === null
      ? []
      : [
          {
            first: pairing.firstEntrantId,
            second: pairing.secondEntrantId,
            position: pairing.position,
            bracket: "winners" as const,
          },
        ],
  );
}

export async function startDuelEvent(
  db: ExtendedPrismaClient,
  options: {
    readonly guildId: DiscordGuildId;
    readonly eventId: string;
    readonly actorDiscordId: DiscordAccountId;
    readonly stage: ScoutStage;
    readonly manualOrder?: readonly string[];
  },
): Promise<StartedSeries[]> {
  return await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-duel-event-registration'), hashtext(${options.eventId}))`;
    const event = await tx.duelEvent.findFirstOrThrow({
      where: { id: options.eventId, guildId: options.guildId },
      include: {
        entrants: {
          where: { registrationState: "accepted" },
          include: {
            competitor: { include: { members: true } },
          },
        },
        roundOverrides: true,
      },
    });
    if (event.organizerDiscordId !== options.actorDiscordId) {
      throw new Error("Only the organizer may start this event");
    }
    if (event.eventState !== "registration_open") {
      throw new Error("This event has already started");
    }
    const format = DuelEventFormatSchema.parse(event.format);
    if (format === "direct") throw new Error("Direct duels are not events");
    assertEventLimits(format, event.entrants.length);
    const members = event.entrants.flatMap(
      (entrant) => entrant.competitor.members,
    );
    const currentPlayers = await tx.player.findMany({
      where: {
        id: { in: members.map((member) => member.playerId) },
        serverId: options.guildId,
      },
      select: { id: true, discordId: true },
    });
    const disclosures = await tx.duelDisclosureAcceptance.findMany({
      where: {
        guildId: event.guildId,
        playerId: { in: currentPlayers.map((player) => player.id) },
        disclosureVersion: DUEL_DISCLOSURE_VERSION,
      },
    });
    if (
      !currentPlayers.every(
        (player) =>
          player.discordId !== null &&
          members.some(
            (member) =>
              member.playerId === player.id &&
              member.discordId === player.discordId,
          ) &&
          disclosures.some(
            (disclosure) =>
              disclosure.playerId === player.id &&
              disclosure.discordId === player.discordId,
          ),
      ) ||
      currentPlayers.length !== members.length
    ) {
      throw new Error(
        "Every entrant must retain disclosure consent under their current Discord identity",
      );
    }
    const entrantsById = new Map(
      event.entrants.map((entrant) => [entrant.competitorId, entrant]),
    );
    const entrantIds = event.entrants.map((entrant) => entrant.competitorId);
    const subjectByEntrant = new Map(
      event.entrants.map((entrant) => {
        const playerIds = entrant.competitor.members
          .map((member) => member.playerId)
          .toSorted((left, right) => left - right);
        return [
          entrant.competitorId,
          playerIds.length === 1
            ? `player:${playerIds[0]?.toString() ?? ""}`
            : `pair:${playerIds.map(String).join("+")}`,
        ];
      }),
    );
    const records = await tx.duelRecord.findMany({
      where: {
        guildId: event.guildId,
        scope: event.competitorKind === "pair" ? "pair" : "individual",
        subjectKey: { in: [...subjectByEntrant.values()] },
        opponentKey: "",
      },
    });
    const winsBySubject = new Map(
      records.map((record) => [record.subjectKey, record.wins]),
    );
    const rollingWins = Object.fromEntries(
      entrantIds.map((entrantId) => [
        entrantId,
        winsBySubject.get(subjectByEntrant.get(entrantId) ?? "") ?? 0,
      ]),
    );
    const seedMethod = parseDuelSeedMethod(event.seedMethod);
    const sourceIds = duelSeedSourceIds({
      seedMethod,
      manualOrder: options.manualOrder,
      entrantIds,
    });
    const seededIds = seedDuelEntrants(
      sourceIds,
      seedMethod,
      rollingWins,
      event.randomSeed,
    );
    const deadlineAt = new Date(
      Date.now() + event.matchWindowHours * 60 * 60 * 1000,
    );
    const firstRoundBestOf = DuelBestOfSchema.parse(
      event.roundOverrides.find((override) => override.roundNumber === 1)
        ?.bestOf ?? event.bestOf,
    );
    const pairings = openingPairings(format, seededIds);
    for (const [index, competitorId] of seededIds.entries()) {
      await tx.duelEventEntrant.update({
        where: {
          eventId_competitorId: { eventId: event.id, competitorId },
        },
        data: { seed: index + 1 },
      });
    }
    const started: StartedSeries[] = [];
    for (const pairing of pairings) {
      const first = entrantsById.get(pairing.first);
      const second = entrantsById.get(pairing.second);
      if (first === undefined || second === undefined) {
        throw new Error("A seeded duel entrant disappeared during event start");
      }
      const data = seriesCreateData({
        event,
        first,
        second,
        roundNumber: 1,
        position: pairing.position,
        bracket: pairing.bracket,
        bestOf: firstRoundBestOf,
        stage: options.stage,
        deadlineAt,
      });
      const series = await tx.duelSeries.create({ data });
      started.push({ seriesId: series.id, deadlineAt });
    }
    await tx.duelEvent.update({
      where: { id: event.id },
      data: { eventState: "in_progress", startedAt: new Date() },
    });
    return started;
  });
}
