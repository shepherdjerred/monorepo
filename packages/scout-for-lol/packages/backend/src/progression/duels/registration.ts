import {
  DUEL_DISCLOSURE_VERSION,
  DiscordGuildIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  duelCompetitorCreateData,
  resolveDuelCompetitorSelection,
  type DuelCompetitorSelection,
} from "#src/progression/duels/competitors.ts";

function assertSingleRiotRegion(regions: readonly string[]): void {
  if (new Set(regions).size !== 1) {
    throw new Error("Duel competitors must use accounts in one Riot region");
  }
}

export async function registerDuelEventEntrant(
  db: ExtendedPrismaClient,
  options: {
    readonly guildId: DiscordGuildId;
    readonly eventId: string;
    readonly actorDiscordId: DiscordAccountId;
    readonly selection: DuelCompetitorSelection;
    readonly source: "open" | "invitation";
  },
) {
  return await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-duel-event-registration'), hashtext(${options.eventId}))`;
    const event = await tx.duelEvent.findFirstOrThrow({
      where: { id: options.eventId, guildId: options.guildId },
    });
    if (event.eventState !== "registration_open") {
      throw new Error("This event is not accepting registrations");
    }
    if (
      event.registrationClosesAt !== null &&
      event.registrationClosesAt <= new Date()
    ) {
      throw new Error("Registration has closed");
    }
    if (options.source === "open" && event.registrationMode !== "open") {
      throw new Error("This event accepts invitations only");
    }
    if (
      options.source === "invitation" &&
      event.organizerDiscordId !== options.actorDiscordId
    ) {
      throw new Error("Only the organizer may invite an entrant");
    }
    const kind = event.competitorKind === "player" ? "player" : "pair";
    const guildId = DiscordGuildIdSchema.parse(event.guildId);
    const competitor = await resolveDuelCompetitorSelection(
      tx,
      guildId,
      kind,
      options.selection,
    );
    const existingEntrants = await tx.duelEventEntrant.findMany({
      where: { eventId: event.id },
      include: { competitor: { include: { members: true } } },
    });
    assertSingleRiotRegion([
      ...competitor.accounts.map((account) => account.region),
      ...existingEntrants
        .filter((entrant) => entrant.registrationState === "accepted")
        .flatMap((entrant) =>
          entrant.competitor.members.map((member) => member.region),
        ),
    ]);
    const registeredPlayerIds = new Set(
      existingEntrants.flatMap((entrant) =>
        entrant.competitor.members.map((member) => member.playerId),
      ),
    );
    if (
      competitor.accounts.some((account) =>
        registeredPlayerIds.has(account.playerId),
      )
    ) {
      throw new Error("A guild player may enter an event only once");
    }
    if (
      options.source === "open" &&
      !competitor.accounts.some(
        (account) => account.discordId === options.actorDiscordId,
      )
    ) {
      throw new Error("Open registration must include the signed-in player");
    }
    const row = await tx.duelCompetitor.create({
      data: duelCompetitorCreateData(guildId, competitor),
    });
    await tx.duelEventEntrant.create({
      data: {
        eventId: event.id,
        competitorId: row.id,
        registrationSource: options.source,
        registrationState: "pending",
        invitedAt: options.source === "invitation" ? new Date() : null,
        registeredAt: options.source === "open" ? new Date() : null,
      },
    });
    return { competitorId: row.id };
  });
}

export async function acceptDuelEventRegistration(
  db: ExtendedPrismaClient,
  options: {
    readonly guildId: DiscordGuildId;
    readonly eventId: string;
    readonly competitorId: string;
    readonly actorDiscordId: DiscordAccountId;
  },
) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-duel-event-registration'), hashtext(${options.eventId}))`;
    const entrant = await tx.duelEventEntrant.findUniqueOrThrow({
      where: {
        eventId_competitorId: {
          eventId: options.eventId,
          competitorId: options.competitorId,
        },
      },
      include: {
        event: true,
        competitor: { include: { members: true } },
      },
    });
    if (entrant.event.guildId !== options.guildId) {
      throw new Error("Event does not belong to this guild");
    }
    if (entrant.event.eventState !== "registration_open") {
      throw new Error("This event is not accepting registrations");
    }
    if (
      entrant.event.registrationClosesAt !== null &&
      entrant.event.registrationClosesAt <= new Date()
    ) {
      throw new Error("Registration has closed");
    }
    const acceptedEntrants = await tx.duelEventEntrant.findMany({
      where: {
        eventId: entrant.eventId,
        registrationState: "accepted",
        competitorId: { not: entrant.competitorId },
      },
      include: { competitor: { include: { members: true } } },
    });
    assertSingleRiotRegion([
      ...entrant.competitor.members.map((member) => member.region),
      ...acceptedEntrants.flatMap((acceptedEntrant) =>
        acceptedEntrant.competitor.members.map((member) => member.region),
      ),
    ]);
    const maximum = entrant.event.format === "round_robin" ? 16 : 64;
    const acceptedCompetitors = await tx.duelEventEntrant.count({
      where: {
        eventId: entrant.eventId,
        registrationState: "accepted",
        competitorId: { not: entrant.competitorId },
      },
    });
    if (acceptedCompetitors >= maximum) {
      throw new Error(`This event is capped at ${maximum.toString()} entrants`);
    }
    const players = await tx.player.findMany({
      where: {
        id: {
          in: entrant.competitor.members.map((member) => member.playerId),
        },
        serverId: options.guildId,
      },
      select: { id: true, discordId: true },
    });
    if (
      !players.some((player) => player.discordId === options.actorDiscordId)
    ) {
      throw new Error("Only an invited competitor may accept registration");
    }
    if (players.length !== entrant.competitor.members.length) {
      throw new Error("Every invited guild player must still be tracked");
    }
    const disclosures = await tx.duelDisclosureAcceptance.findMany({
      where: {
        guildId: entrant.event.guildId,
        playerId: { in: players.map((player) => player.id) },
        disclosureVersion: DUEL_DISCLOSURE_VERSION,
      },
    });
    if (
      !players.every(
        (player) =>
          player.discordId !== null &&
          disclosures.some(
            (disclosure) =>
              disclosure.playerId === player.id &&
              disclosure.discordId === player.discordId,
          ),
      )
    ) {
      throw new Error(
        "Every teammate must accept the custom-match disclosure first",
      );
    }
    for (const player of players) {
      if (player.discordId === null) {
        throw new Error("Every teammate must retain a Discord identity");
      }
      await tx.duelCompetitorMember.update({
        where: {
          competitorId_playerId: {
            competitorId: entrant.competitorId,
            playerId: player.id,
          },
        },
        data: { discordId: player.discordId },
      });
    }
    await tx.duelEventEntrant.update({
      where: {
        eventId_competitorId: {
          eventId: entrant.eventId,
          competitorId: entrant.competitorId,
        },
      },
      data: { registrationState: "accepted", acceptedAt: new Date() },
    });
  });
}
