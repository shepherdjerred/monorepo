import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import {
  LCU_BOT_UUID,
  lcuUuidsIn,
  translatePayloadIdentities,
} from "#src/scout-client/identity-alias.ts";

/**
 * Real games as the Scout Client bundles them — `games/{id}`, the end-of-game
 * block, and `game-timelines/{id}` — from `packages/scout-for-lol/testdata/lcu/`,
 * redacted: every player UUID is a stable fake, every name a placeholder, and
 * the chat credentials the League client includes are gone.
 */
export const LcuBundleFixtureSchema = z
  .object({
    matchHistory: z
      .object({
        gameDuration: z.number(),
        gameId: z.number(),
        platformId: z.string(),
      })
      .loose(),
    endOfGame: z.unknown(),
    timeline: z.unknown(),
  })
  .strict();
export type LcuBundleFixture = z.infer<typeof LcuBundleFixtureSchema>;

/** The parts of a bundle a bot rewrite touches; everything else passes through. */
const BotEditableSchema = z.looseObject({
  matchHistory: z.looseObject({
    participantIdentities: z.array(
      z.looseObject({
        participantId: z.number(),
        player: z.looseObject({ puuid: z.string() }),
      }),
    ),
    participants: z.array(
      z.looseObject({
        participantId: z.number(),
        teamId: z.number(),
        championId: z.number(),
      }),
    ),
  }),
  endOfGame: z.looseObject({
    teams: z.array(
      z.looseObject({
        players: z.array(
          z.looseObject({
            puuid: z.string(),
            botPlayer: z.boolean(),
            championId: z.number(),
          }),
        ),
      }),
    ),
  }),
});

export async function rawLcuFixture(name: string): Promise<unknown> {
  return Bun.file(
    new URL(`../../../../testdata/lcu/${name}.json`, import.meta.url),
  ).json();
}

/** Stand-ins for the alias table: each fake UUID to a 78-character PUUID. */
export function lcuAliasesFor(raw: unknown): ReadonlyMap<string, string> {
  return new Map(
    [...lcuUuidsIn(raw)].map((uuid) => [uuid, `${uuid}-${"p".repeat(41)}`]),
  );
}

export function withLcuTiming(bundle: LcuBundleFixture) {
  const start = 1_790_000_000_000;
  return {
    ...bundle,
    timing: {
      gameStartTimestamp: start,
      gameEndTimestamp: start + bundle.matchHistory.gameDuration * 1000,
    },
  };
}

export type TimedLcuBundle = ReturnType<typeof withLcuTiming>;

export function lcuBundleMatchId(bundle: LcuBundleFixture): RiotMatchId {
  return RiotMatchIdSchema.parse(
    `${bundle.matchHistory.platformId}_${bundle.matchHistory.gameId.toString()}`,
  );
}

/** The fixture with every League-client UUID aliased to a PUUID. */
export async function aliasedLcuBundle(name: string): Promise<TimedLcuBundle> {
  const raw = await rawLcuFixture(name);
  return withLcuTiming(
    LcuBundleFixtureSchema.parse(
      translatePayloadIdentities(raw, lcuAliasesFor(raw)),
    ),
  );
}

/**
 * The fixture with the given participants turned into bots, as the League
 * client reports one: the zero UUID in history and end-of-game alike, and the
 * end-of-game block's own bot flag. `champion` overrides a bot's champion.
 */
function asBots(
  raw: unknown,
  participantIds: readonly number[],
  champion?: number,
): unknown {
  const game = BotEditableSchema.parse(structuredClone(raw));
  for (const participantId of participantIds) {
    const identity = game.matchHistory.participantIdentities.find(
      (candidate) => candidate.participantId === participantId,
    );
    const participant = game.matchHistory.participants.find(
      (candidate) => candidate.participantId === participantId,
    );
    if (identity === undefined || participant === undefined) {
      throw new Error(`Fixture has no participant ${participantId.toString()}`);
    }
    const player = game.endOfGame.teams
      .flatMap((team) => team.players)
      .find((candidate) => candidate.puuid === identity.player.puuid);
    if (player === undefined) {
      throw new Error(
        `Fixture has no end-of-game row for ${identity.player.puuid}`,
      );
    }
    identity.player.puuid = LCU_BOT_UUID;
    player.puuid = LCU_BOT_UUID;
    player.botPlayer = true;
    if (champion !== undefined) {
      participant.championId = champion;
      player.championId = champion;
    }
  }
  return game;
}

/** The Classic fixture with these participants as bots and the rest aliased. */
export async function lcuBotBundle(
  participantIds: readonly number[],
  champion?: number,
): Promise<TimedLcuBundle> {
  const raw = asBots(
    await rawLcuFixture("lcu-postgame-classic"),
    participantIds,
    champion,
  );
  return withLcuTiming(
    LcuBundleFixtureSchema.parse(
      translatePayloadIdentities(raw, lcuAliasesFor(raw)),
    ),
  );
}
