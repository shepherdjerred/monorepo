import type { EndOfGameMatch } from "@scout-for-lol/data";
import type { RiotMatchId } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { convertEndOfGameMatch } from "#src/scout-client/canonical/eog-match.ts";
import { translatePayloadIdentities } from "#src/scout-client/identity-alias.ts";
import {
  aliasedLcuBundle,
  lcuAliasesFor,
  lcuBundleMatchId,
  rawLcuFixture,
} from "#src/testing/report-lake/lcu-bundle-fixtures.ts";

/**
 * The real Classic game (`testdata/lcu/lcu-postgame-classic.json`) as a
 * client that served no match history uploads it: its end-of-game block
 * alone, plus the gameflow session the same device reported.
 */
export const EndOfGameBlockFixtureSchema = z.looseObject({
  gameId: z.number(),
  queueType: z.string(),
  gameMode: z.string(),
  endOfGameTimestamp: z.number(),
  teams: z.array(
    z.looseObject({
      players: z.array(
        z.looseObject({
          puuid: z.string(),
          botPlayer: z.boolean(),
          stats: z.record(z.string(), z.unknown()),
        }),
      ),
    }),
  ),
});
export type EndOfGameBlockFixture = z.infer<typeof EndOfGameBlockFixtureSchema>;

const FixtureSchema = z.looseObject({ endOfGame: EndOfGameBlockFixtureSchema });

/** The Classic block as the League client sends it, unaliased. */
export async function rawClassicEndOfGameBlock(): Promise<EndOfGameBlockFixture> {
  return FixtureSchema.parse(await rawLcuFixture("lcu-postgame-classic"))
    .endOfGame;
}

/** The Classic block with every League-client UUID aliased to a PUUID. */
export async function classicEndOfGameBlock(): Promise<EndOfGameBlockFixture> {
  const raw = await rawLcuFixture("lcu-postgame-classic");
  return FixtureSchema.parse(
    translatePayloadIdentities(raw, lcuAliasesFor(raw)),
  ).endOfGame;
}

export async function classicMatchId(): Promise<RiotMatchId> {
  return lcuBundleMatchId(await aliasedLcuBundle("lcu-postgame-classic"));
}

/** The gameflow session a device stores for the game, as its payload. */
export function classicGameflow(
  block: EndOfGameBlockFixture,
  gameData: Record<string, unknown> = {},
) {
  return {
    resource: "gameflow_session",
    data: {
      phase: "InProgress",
      gameData: {
        gameId: block.gameId,
        queue: {
          id: 4310,
          type: block.queueType,
          gameMode: block.gameMode,
          mapId: 453,
        },
        bannedChampions: [],
        ...gameData,
      },
    },
  };
}

/** The Classic game converted from its end-of-game block alone. */
export async function classicEndOfGameMatch(
  edit?: (block: EndOfGameBlockFixture) => void,
): Promise<EndOfGameMatch> {
  const block = await classicEndOfGameBlock();
  edit?.(block);
  const match = convertEndOfGameMatch({
    matchId: await classicMatchId(),
    endOfGame: block,
    gameflow: classicGameflow(block),
  });
  if (match === null) throw new Error("The Classic block must convert");
  return match;
}
