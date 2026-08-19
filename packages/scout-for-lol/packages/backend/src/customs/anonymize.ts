import {
  CustomAccountSchema,
  CustomGameSnapshotSchema,
  CustomNightSnapshotSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type CustomGameSnapshot,
  type CustomNightSnapshot,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import { recruitmentCounts } from "#src/customs/snapshot.ts";

const ANONYMIZED_DISCORD_ID = DiscordAccountIdSchema.parse("00000000000000000");
const ANONYMIZED_TEXT = "Anonymous player";

type SensitiveValues = {
  strings: ReadonlySet<string>;
  numbers: ReadonlySet<number>;
};

const STRING_IDENTITY_KEYS = new Set([
  "discordId",
  "hostDiscordId",
  "incomingDiscordId",
  "outgoingDiscordId",
  "puuid",
  "targetDiscordId",
]);
const STRING_IDENTITY_ARRAY_KEYS = new Set([
  "cohostDiscordIds",
  "overdueDiscordIds",
  "rosterDiscordIds",
  "selectedDiscordIds",
]);
const NUMBER_IDENTITY_KEYS = new Set([
  "accountId",
  "playerId",
  "selectedAccountId",
]);
const FREE_TEXT_KEYS = new Set([
  "failure",
  "failures",
  "message",
  "note",
  "repeatChampionWarnings",
  "warning",
  "warnings",
]);
const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && WORD_CHARACTER.test(value);
}

function replaceIdentityInText(value: string, candidate: string): string {
  let cursor = 0;
  let redacted = "";
  for (;;) {
    const index = value.indexOf(candidate, cursor);
    if (index === -1) return redacted + value.slice(cursor);
    const end = index + candidate.length;
    const hasBoundary =
      !isWordCharacter(value[index - 1]) && !isWordCharacter(value[end]);
    redacted += value.slice(cursor, index);
    redacted += hasBoundary ? ANONYMIZED_TEXT : candidate;
    cursor = end;
  }
}

function redactText(value: string, sensitive: ReadonlySet<string>): string {
  let redacted = value;
  for (const candidate of sensitive) {
    if (candidate.length === 0) continue;
    redacted = replaceIdentityInText(redacted, candidate);
  }
  return redacted;
}

function redactCustomEntry(
  value: unknown,
  sensitive: SensitiveValues,
  key: string | null,
): unknown {
  if (typeof value === "string") {
    if (
      key !== null &&
      (STRING_IDENTITY_KEYS.has(key) || STRING_IDENTITY_ARRAY_KEYS.has(key)) &&
      sensitive.strings.has(value)
    ) {
      return ANONYMIZED_TEXT;
    }
    return key !== null && FREE_TEXT_KEYS.has(key)
      ? redactText(value, sensitive.strings)
      : value;
  }
  if (
    typeof value === "number" &&
    key !== null &&
    NUMBER_IDENTITY_KEYS.has(key) &&
    sensitive.numbers.has(value)
  ) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCustomEntry(entry, sensitive, key));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entry]) => [
        entryKey,
        redactCustomEntry(entry, sensitive, entryKey),
      ]),
    );
  }
  return value;
}

export function redactCustomValue(
  value: unknown,
  sensitive: SensitiveValues,
): unknown {
  return redactCustomEntry(value, sensitive, null);
}

function anonymizeGameSnapshot(
  game: CustomGameSnapshot,
  discordId: string,
  sensitive: SensitiveValues,
): CustomGameSnapshot {
  return CustomGameSnapshotSchema.parse({
    ...game,
    participants: game.participants.filter(
      (participant) => participant.discordId !== discordId,
    ),
    repeatChampionWarnings: game.repeatChampionWarnings.map((warning) =>
      redactText(warning, sensitive.strings),
    ),
  });
}

export function anonymizeNightSnapshot(params: {
  snapshot: CustomNightSnapshot;
  discordId: string;
  sensitive: SensitiveValues;
}): CustomNightSnapshot {
  const participants = params.snapshot.participants.filter(
    (participant) => participant.discordId !== params.discordId,
  );
  return CustomNightSnapshotSchema.parse({
    ...params.snapshot,
    revision: params.snapshot.revision + 1,
    hostDiscordId:
      params.snapshot.hostDiscordId === params.discordId
        ? ANONYMIZED_DISCORD_ID
        : params.snapshot.hostDiscordId,
    cohostDiscordIds: params.snapshot.cohostDiscordIds.filter(
      (discordId) => discordId !== params.discordId,
    ),
    participants,
    currentGame:
      params.snapshot.currentGame === null
        ? null
        : anonymizeGameSnapshot(
            params.snapshot.currentGame,
            params.discordId,
            params.sensitive,
          ),
    recruitmentCounts: recruitmentCounts(participants),
  });
}

function addString(values: Set<string>, value: string | null): void {
  if (value !== null && value.length > 0) values.add(value);
}

export type CustomAnonymizationReport = {
  guildId: string;
  discordId: string;
  nights: number;
  nightParticipants: number;
  gameParticipants: number;
  consents: number;
  auditEvents: number;
  executed: boolean;
};

export async function anonymizeCustomParticipant(params: {
  prisma: ExtendedPrismaClient;
  guildId: string;
  discordId: string;
  execute: boolean;
}): Promise<CustomAnonymizationReport> {
  const guildId = DiscordGuildIdSchema.parse(params.guildId);
  const discordId = DiscordAccountIdSchema.parse(params.discordId);
  const nights = await params.prisma.customNight.findMany({
    where: {
      guildId,
      participants: { some: { discordId } },
    },
    include: {
      activePointer: true,
      participants: true,
      games: { include: { participants: true } },
      auditEvents: true,
    },
  });
  const activeNight = nights.find(
    (night) => night.activePointer !== null || night.state !== "ENDED",
  );
  if (activeNight !== undefined) {
    throw new Error(
      `Cannot anonymize an active custom night (${activeNight.id}); end it first`,
    );
  }
  const consents = await params.prisma.customConsent.count({
    where: { guildId, discordId },
  });
  const report: CustomAnonymizationReport = {
    guildId,
    discordId,
    nights: nights.length,
    nightParticipants: nights.reduce(
      (count, night) =>
        count +
        night.participants.filter(
          (participant) => participant.discordId === discordId,
        ).length,
      0,
    ),
    gameParticipants: nights.reduce(
      (count, night) =>
        count +
        night.games
          .flatMap((game) => game.participants)
          .filter((participant) => participant.discordId === discordId).length,
      0,
    ),
    consents,
    auditEvents: nights.reduce(
      (count, night) => count + night.auditEvents.length,
      0,
    ),
    executed: params.execute,
  };
  if (!params.execute || (consents === 0 && nights.length === 0)) return report;

  await params.prisma.$transaction(async (transaction) => {
    // Re-read inside the write transaction. The initial report query is only a
    // preview; using it for the write would allow a concurrent anonymization to
    // be overwritten by a stale snapshot.
    const currentNights = await transaction.customNight.findMany({
      where: {
        guildId,
        participants: { some: { discordId } },
      },
      include: {
        activePointer: true,
        participants: true,
        games: { include: { participants: true } },
        auditEvents: true,
      },
    });
    const currentActiveNight = currentNights.find(
      (night) => night.activePointer !== null || night.state !== "ENDED",
    );
    if (currentActiveNight !== undefined) {
      throw new Error(
        `Cannot anonymize an active custom night (${currentActiveNight.id}); end it first`,
      );
    }

    for (const night of currentNights) {
      const strings = new Set<string>([discordId]);
      const numbers = new Set<number>();
      for (const participant of night.participants) {
        if (participant.discordId !== discordId) continue;
        addString(strings, participant.displayName);
        addString(strings, participant.playerAlias);
        if (participant.playerId !== null) numbers.add(participant.playerId);
        if (participant.selectedAccountId !== null)
          numbers.add(participant.selectedAccountId);
        const accounts = CustomAccountSchema.array().parse(
          JSON.parse(participant.accountsSnapshot),
        );
        for (const account of accounts) {
          numbers.add(account.accountId);
          strings.add(account.puuid);
          addString(strings, account.riotGameName);
          addString(strings, account.riotTagLine);
        }
      }
      for (const participant of night.games.flatMap(
        (game) => game.participants,
      )) {
        if (participant.discordId !== discordId) continue;
        strings.add(participant.displayName);
        strings.add(participant.playerAlias);
        strings.add(participant.puuid);
        addString(strings, participant.riotGameName);
        addString(strings, participant.riotTagLine);
        numbers.add(participant.playerId);
        numbers.add(participant.accountId);
      }
      const sensitive = { strings, numbers };
      const snapshot = anonymizeNightSnapshot({
        snapshot: CustomNightSnapshotSchema.parse(JSON.parse(night.snapshot)),
        discordId,
        sensitive,
      });
      const nextRevision = night.revision + 1;
      const updatedSnapshot = { ...snapshot, revision: nextRevision };
      for (const game of night.games) {
        const gameSnapshot = anonymizeGameSnapshot(
          CustomGameSnapshotSchema.parse(JSON.parse(game.snapshot)),
          discordId,
          sensitive,
        );
        await transaction.customGame.update({
          where: { id: game.id },
          data: {
            snapshot: JSON.stringify(gameSnapshot),
            matchSnapshot: null,
          },
        });
        await transaction.customGameParticipant.deleteMany({
          where: { gameId: game.id, discordId },
        });
      }
      for (const audit of night.auditEvents) {
        await transaction.customAuditEvent.update({
          where: { id: audit.id },
          data: {
            actorId:
              audit.actorId === discordId
                ? ANONYMIZED_DISCORD_ID
                : audit.actorId,
            payload: JSON.stringify(
              redactCustomValue(JSON.parse(audit.payload), sensitive),
            ),
          },
        });
      }
      await transaction.customNightParticipant.deleteMany({
        where: { nightId: night.id, discordId },
      });
      const updatedNight = await transaction.customNight.updateMany({
        where: { id: night.id, revision: night.revision },
        data: {
          hostDiscordId: DiscordAccountIdSchema.parse(
            updatedSnapshot.hostDiscordId,
          ),
          cohostDiscordIds: JSON.stringify(updatedSnapshot.cohostDiscordIds),
          revision: nextRevision,
          snapshot: JSON.stringify(updatedSnapshot),
        },
      });
      if (updatedNight.count !== 1) {
        throw new Error(
          `Custom night ${night.id} changed during anonymization; retry the operation`,
        );
      }
      await transaction.customAuditEvent.create({
        data: {
          nightId: night.id,
          revision: nextRevision,
          actorId: ANONYMIZED_DISCORD_ID,
          action: "PARTICIPANT_ANONYMIZED",
          payload: JSON.stringify({ recordsRemoved: true }),
          source: "OPERATOR",
        },
      });
    }
    await transaction.customConsent.deleteMany({
      where: { guildId, discordId },
    });
  });
  return report;
}
