import { vi } from "vitest";
import {
  AccountIdSchema,
  PlayerIdSchema,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type { ExtendedPrismaClient } from "#src/database/index.ts";
import {
  testAccountId,
  testChannelId,
  testGuildId,
  testPuuid,
} from "#src/testing/test-ids.ts";
import { createCustomNight } from "#src/customs/repository.ts";
import { buildCustomNightSnapshot } from "#src/customs/snapshot.ts";
import { commitCustomOperation } from "#src/customs/operations/request.ts";
import type { CustomVoicePort } from "#src/customs/operations/execution-steps.ts";

export async function seedCustomOperation(
  db: ExtendedPrismaClient,
  hostId: DiscordAccountId,
  now: Date,
  action: "arrange" | "end" = "arrange",
) {
  const created = await createCustomNight(db, {
    guildId: testGuildId("8501"),
    guildName: "Test Guild",
    launchChannelId: testChannelId("8502"),
    voiceLobbyChannelId: testChannelId("8503"),
    hostDiscordId: hostId,
    hostDisplayName: "Host",
    hostAvatarUrl: undefined,
    disclosureVersion: "2026-08-29",
    now,
  });
  const game = await db.customGame.create({
    data: {
      nightId: created.id,
      sequence: 1,
      state: "LOBBY_READY",
      rosterMode: "FIRST_TEN",
      map: "SUMMONERS_RIFT",
      pickMode: "TOURNAMENT_DRAFT",
      participants: {
        create: Array.from({ length: 10 }, (_, index) => ({
          discordId: testAccountId((8510 + index).toString()),
          displayName: `Player ${index.toString()}`,
          playerId: PlayerIdSchema.parse(index + 1),
          playerAlias: `P${index.toString()}`,
          accountId: AccountIdSchema.parse(index + 1),
          puuid: testPuuid((8510 + index).toString()),
          rosterOrder: index,
          team: index < 5 ? "A" : "B",
          side: index < 5 ? "BLUE" : "RED",
          captain: index === 0 || index === 5,
        })),
      },
    },
  });
  const snapshot = await buildCustomNightSnapshot(db, created.id, hostId, now);
  if (snapshot === undefined) throw new Error("Expected seeded night");
  const input = { nightId: created.id, expectedRevision: snapshot.revision };
  const operationId = await commitCustomOperation(db, snapshot, {
    actorDiscordId: hostId,
    action,
    input,
    now,
  });
  return { operationId, snapshot, input, gameId: game.id };
}

export function customVoicePortFixture(): CustomVoicePort & {
  createTeam: ReturnType<typeof vi.fn<CustomVoicePort["createTeam"]>>;
  move: ReturnType<typeof vi.fn<CustomVoicePort["move"]>>;
  deleteChannel: ReturnType<typeof vi.fn<CustomVoicePort["deleteChannel"]>>;
} {
  return {
    assertReady: vi.fn(),
    createTeam: vi.fn((team) =>
      Promise.resolve(testChannelId(team === "A" ? "8601" : "8602")),
    ),
    move: vi.fn<CustomVoicePort["move"]>().mockResolvedValue(undefined),
    deleteChannel: vi
      .fn<CustomVoicePort["deleteChannel"]>()
      .mockResolvedValue(undefined),
  };
}
