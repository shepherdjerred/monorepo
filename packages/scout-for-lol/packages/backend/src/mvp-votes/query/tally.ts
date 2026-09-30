import { z } from "zod";
import {
  DiscordGuildIdSchema,
  LeaguePuuidSchema,
  MatchIdSchema,
  type DiscordGuildId,
  type LeaguePuuid,
  type MatchId,
  type RiotTeamId,
} from "@scout-for-lol/data";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import { guildAliasesForRoster } from "#src/mvp-votes/eligibility.ts";
import { mvpQueryDisplayName } from "#src/mvp-votes/query/names.ts";
import {
  MatchMvpRosterSchema,
  nomineeAt,
  type MatchMvpRoster,
} from "#src/mvp-votes/roster.ts";
import { groupMatchMvpVotesForTeam } from "#src/mvp-votes/vote-groups.ts";
import {
  listMatchMvpVotes,
  type StoredMatchMvpVote,
} from "#src/mvp-votes/vote.ts";

export const MatchMvpTallyReasonSchema = z.strictObject({
  voterName: z.string().min(1),
  justification: z.string().min(1),
});

export const MatchMvpTallyNomineeSchema = z.strictObject({
  puuid: LeaguePuuidSchema,
  displayName: z.string().min(1),
  championName: z.string().min(1),
  voteCount: z.number().int().positive(),
  reasons: z.array(MatchMvpTallyReasonSchema),
});

export const MatchMvpGuildTallySchema = z.strictObject({
  guildId: DiscordGuildIdSchema,
  guildName: z.string().min(1),
  blue: z.array(MatchMvpTallyNomineeSchema),
  red: z.array(MatchMvpTallyNomineeSchema),
});

export const MatchMvpTallyResultSchema = z.strictObject({
  matchId: MatchIdSchema,
  showGuildNames: z.boolean(),
  guilds: z.array(MatchMvpGuildTallySchema).min(1),
});

export type MatchMvpTallyNominee = z.infer<typeof MatchMvpTallyNomineeSchema>;
export type MatchMvpGuildTally = z.infer<typeof MatchMvpGuildTallySchema>;
export type MatchMvpTallyResult = z.infer<typeof MatchMvpTallyResultSchema>;

export type MatchMvpTallyGuild = {
  id: DiscordGuildId;
  name: string;
};

type NomineeBucket = {
  nomineeIndex: number;
  count: number;
  reasons: { voterName: string; justification: string }[];
};

function bucketsForTeam(
  votes: readonly StoredMatchMvpVote[],
  teamId: RiotTeamId,
  roster: MatchMvpRoster,
  aliases: ReadonlyMap<LeaguePuuid, string>,
): MatchMvpTallyNominee[] {
  return groupMatchMvpVotesForTeam(votes, teamId, roster).map((group) => {
    const participant = nomineeAt(roster, group.nomineeIndex);
    const reasons: NomineeBucket["reasons"] = [];
    for (const vote of group.votes) {
      if (vote.justification !== null) {
        reasons.push({
          voterName: mvpQueryDisplayName(vote.voterPuuid, roster, aliases),
          justification: vote.justification,
        });
      }
    }
    return {
      puuid: participant.puuid,
      displayName: mvpQueryDisplayName(participant.puuid, roster, aliases),
      championName: participant.championName,
      voteCount: group.votes.length,
      reasons,
    };
  });
}

async function tallyForGuild(
  input: {
    matchId: MatchId;
    guild: MatchMvpTallyGuild;
    roster: MatchMvpRoster;
  },
  prismaClient: ExtendedPrismaClient,
): Promise<MatchMvpGuildTally | null> {
  const votes = await listMatchMvpVotes(
    { matchId: input.matchId, serverId: input.guild.id },
    prismaClient,
  );
  if (votes.length === 0) {
    return null;
  }
  const aliases = await guildAliasesForRoster(
    { serverId: input.guild.id, roster: input.roster },
    prismaClient,
  );
  return {
    guildId: input.guild.id,
    guildName: input.guild.name,
    blue: bucketsForTeam(votes, 100, input.roster, aliases),
    red: bucketsForTeam(votes, 200, input.roster, aliases),
  };
}

/**
 * Viewer-scoped match tally. Null when there is no contest or none of the
 * given guilds have recorded a vote — the Explore match page is otherwise
 * guild-neutral and must not leak another server's ballots.
 */
export async function loadMatchMvpTallyForGuilds(
  input: {
    matchId: MatchId;
    guilds: readonly MatchMvpTallyGuild[];
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpTallyResult | null> {
  if (input.guilds.length === 0) {
    return null;
  }
  const contest = await prismaClient.matchMvpContest.findUnique({
    where: { matchId: input.matchId },
    select: { roster: true },
  });
  if (contest === null) {
    return null;
  }
  const roster = MatchMvpRosterSchema.parse(contest.roster);
  const guildTallies: MatchMvpGuildTally[] = [];
  for (const guild of input.guilds) {
    const tally = await tallyForGuild(
      { matchId: input.matchId, guild, roster },
      prismaClient,
    );
    if (tally !== null) {
      guildTallies.push(tally);
    }
  }
  if (guildTallies.length === 0) {
    return null;
  }
  return MatchMvpTallyResultSchema.parse({
    matchId: input.matchId,
    showGuildNames: guildTallies.length > 1,
    guilds: guildTallies,
  });
}

export async function loadMatchMvpTallyForGuild(
  input: {
    matchId: MatchId;
    guild: MatchMvpTallyGuild;
  },
  prismaClient: ExtendedPrismaClient = prisma,
): Promise<MatchMvpGuildTally | null> {
  const result = await loadMatchMvpTallyForGuilds(
    { matchId: input.matchId, guilds: [input.guild] },
    prismaClient,
  );
  return result?.guilds[0] ?? null;
}
