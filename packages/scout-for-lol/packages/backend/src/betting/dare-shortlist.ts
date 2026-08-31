import { z } from "zod";
import {
  DiscordAccountIdSchema,
  PlayerIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { DareTargetAccountsSchema } from "#src/betting/dare-criteria.ts";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

/**
 * The closed target list handed to the dare translation model.
 *
 * The model only ever sees `key` and `alias`; the frozen accounts and Discord
 * identity ride along so the command layer can resolve a validated key back to
 * a concrete person without a second query racing the first. Keys are
 * shortlist-local ("T1".."Tn") so the model cannot address anyone the
 * shortlist did not offer.
 */

/** Most people one shortlist may offer. Bounds the prompt, and no guild in the
 * one-server beta is near it. */
export const DARE_SHORTLIST_CAP = 30;

export const DareShortlistEntrySchema = z.strictObject({
  key: z.string().regex(/^T\d{1,2}$/),
  discordId: DiscordAccountIdSchema,
  /** Branded: `BucksDareTarget.playerId` is a real column, so the frozen
   * entry carries the same `PlayerId` brand Prisma expects (unlike the
   * weekly-parlay subjects, which only ever live inside a JSON string). */
  playerId: PlayerIdSchema,
  alias: z.string().min(1),
  accounts: DareTargetAccountsSchema,
});
export type DareShortlistEntry = z.infer<typeof DareShortlistEntrySchema>;

type GroupedTarget = {
  discordId: string;
  playerId: number;
  alias: string;
  /** puuid -> trackingStartedAt ISO string; insertion order is playerId asc,
   * account id asc. The DB's unique (serverId, puuid) makes this a plain
   * union — the Map just states the set semantics explicitly. */
  accounts: Map<string, string>;
};

function compareTargets(a: GroupedTarget, b: GroupedTarget): number {
  if (a.alias !== b.alias) {
    return a.alias < b.alias ? -1 : 1;
  }
  // Aliases are not unique across people; break the tie on the stable Discord
  // identity so the key assignment is deterministic.
  return a.discordId < b.discordId ? -1 : 1;
}

/**
 * Guild-tracked people who can be dared: a non-null Discord identity, at least
 * one linked account, and not the challenger (you cannot put a bounty on
 * yourself). One entry per distinct Discord user, with the union of accounts
 * across every Player row that user owns — the same frozen-account shape the
 * weekly parlays store.
 */
export async function buildDareShortlist(
  serverId: DiscordGuildId,
  challengerDiscordId: DiscordAccountId,
  prismaClient: ExtendedPrismaClient,
): Promise<DareShortlistEntry[]> {
  const players = await prismaClient.player.findMany({
    where: { serverId, discordId: { not: null }, accounts: { some: {} } },
    select: {
      id: true,
      alias: true,
      discordId: true,
      accounts: {
        select: { puuid: true, createdTime: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });

  const byDiscordId = new Map<string, GroupedTarget>();
  for (const player of players) {
    if (player.discordId === null || player.discordId === challengerDiscordId) {
      continue;
    }
    // Lowest playerId wins the alias: rows arrive in id-ascending order, so
    // the first row seen for a Discord user names them.
    const target = byDiscordId.get(player.discordId) ?? {
      discordId: player.discordId,
      playerId: player.id,
      alias: player.alias,
      accounts: new Map<string, string>(),
    };
    for (const account of player.accounts) {
      if (!target.accounts.has(account.puuid)) {
        target.accounts.set(account.puuid, account.createdTime.toISOString());
      }
    }
    byDiscordId.set(target.discordId, target);
  }

  return [...byDiscordId.values()]
    .sort(compareTargets)
    .slice(0, DARE_SHORTLIST_CAP)
    .map((target, index) =>
      DareShortlistEntrySchema.parse({
        key: `T${(index + 1).toString()}`,
        discordId: target.discordId,
        playerId: target.playerId,
        alias: target.alias,
        accounts: [...target.accounts.entries()].map(
          ([puuid, trackingStartedAt]) => ({ puuid, trackingStartedAt }),
        ),
      }),
    );
}
