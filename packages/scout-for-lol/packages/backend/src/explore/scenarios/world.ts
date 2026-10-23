import {
  DiscordAccountIdSchema,
  DiscordChannelIdSchema,
  DiscordGuildIdSchema,
  RegionSchema,
  regionToPlatformRoute,
  toReadableRegion,
  type DiscordAccountId,
  type DiscordChannelId,
  type DiscordGuildId,
  type ExploreScenarioCase,
  type LeaguePuuid,
  type ExploreScenarioSurface,
  type Region,
} from "@scout-for-lol/data";

/**
 * The seeded world one scenario case runs in, on one surface.
 *
 * Every id is derived from the case's position and the surface, never random,
 * so two runs of the same corpus seed byte-identical rows and a report can be
 * compared with the last one. Each (case, surface) pair gets its own guild:
 * a confirmation card minted on the web run must not be visible to the
 * Discord run of the same case.
 */

/** A real lake account a fixture resolved to. */
export type ScenarioAccount = {
  readonly puuid: LeaguePuuid;
  readonly gameName: string;
  readonly tagLine: string;
  readonly region: Region;
  readonly games: number;
};

export type ScenarioMember = {
  readonly id: DiscordAccountId;
  readonly username: string;
  readonly displayName: string;
};

export type ScenarioChannel = {
  readonly id: DiscordChannelId;
  readonly name: string;
};

export type ScenarioWorld = {
  readonly caseId: string;
  readonly surface: ExploreScenarioSurface;
  readonly guildId: DiscordGuildId;
  readonly guildName: string;
  readonly asker: ScenarioMember;
  /** Every member a lookup can find, the asker included. */
  readonly members: readonly ScenarioMember[];
  readonly channels: readonly ScenarioChannel[];
  readonly players: readonly {
    readonly alias: string;
    readonly account: ScenarioAccount;
    readonly discordId: DiscordAccountId | null;
    readonly feedChannelIds: readonly DiscordChannelId[];
  }[];
  readonly candidates: Readonly<Record<string, ScenarioAccount>>;
  /** Scheduled reports the server already has. */
  readonly reports: ExploreScenarioCase["guild"]["reports"];
  /** Confirmation cards earlier turns showed, with what became of them. */
  readonly priorIntents: readonly NonNullable<
    ExploreScenarioCase["priorTurns"][number]["intent"]
  >[];
};

const SURFACE_INDEX: Readonly<Record<ExploreScenarioSurface, number>> = {
  web: 0,
  discord: 1,
  voice: 2,
};

/**
 * An 18-digit snowflake that cannot collide with a real one.
 *
 * Real snowflakes encode a timestamp; a leading 9 puts these far beyond any
 * id Discord has issued, so a fixture row can never shadow a real guild or
 * person in a database that also holds real data.
 */
function snowflake(input: {
  readonly caseIndex: number;
  readonly surface: ExploreScenarioSurface;
  readonly kind: "guild" | "member" | "channel";
  readonly n: number;
}): string {
  const kindIndex = { guild: 0, member: 1, channel: 2 }[input.kind];
  const value =
    900_000_000_000_000_000n +
    BigInt(input.caseIndex) * 1_000_000n +
    BigInt(SURFACE_INDEX[input.surface]) * 100_000n +
    BigInt(kindIndex) * 10_000n +
    BigInt(input.n);
  return value.toString();
}

/** The guild one (case, surface) run is seeded into. */
export function scenarioGuildId(
  caseIndex: number,
  surface: ExploreScenarioSurface,
): DiscordGuildId {
  return DiscordGuildIdSchema.parse(
    snowflake({ caseIndex, surface, kind: "guild", n: 0 }),
  );
}

/** The Region whose platform route matches a lake row's `platform_id`. */
export function regionForPlatform(platformId: string): Region {
  const region = RegionSchema.options.find(
    (candidate) => regionToPlatformRoute(candidate) === platformId,
  );
  if (region === undefined) {
    throw new Error(`No Scout region routes to platform ${platformId}.`);
  }
  return region;
}

export function buildScenarioWorld(input: {
  readonly entry: ExploreScenarioCase;
  readonly caseIndex: number;
  readonly surface: ExploreScenarioSurface;
  /** Resolved accounts for each guild player, in corpus order. */
  readonly playerAccounts: readonly ScenarioAccount[];
  readonly candidates: Readonly<Record<string, ScenarioAccount>>;
}): ScenarioWorld {
  const { entry, caseIndex, surface } = input;
  const id = (kind: "guild" | "member" | "channel", n: number) =>
    snowflake({ caseIndex, surface, kind, n });

  const asker: ScenarioMember = {
    id: DiscordAccountIdSchema.parse(id("member", 0)),
    username: entry.asker.username,
    displayName: entry.asker.displayName,
  };
  const members: ScenarioMember[] = [
    asker,
    ...entry.guild.members.map((member, index) => ({
      id: DiscordAccountIdSchema.parse(id("member", index + 1)),
      username: member.username,
      displayName: member.displayName,
    })),
  ];
  const channels: ScenarioChannel[] = entry.guild.channels.map(
    (name, index) => ({
      id: DiscordChannelIdSchema.parse(id("channel", index)),
      name,
    }),
  );
  const channelId = (name: string): DiscordChannelId => {
    const channel = channels.find((candidate) => candidate.name === name);
    if (channel === undefined) {
      throw new Error(`Case ${entry.id} has no channel named ${name}.`);
    }
    return channel.id;
  };

  return {
    caseId: entry.id,
    surface,
    guildId: scenarioGuildId(caseIndex, surface),
    guildName: entry.guild.name,
    asker,
    members,
    channels,
    players: entry.guild.players.map((player, index) => {
      const account = input.playerAccounts[index];
      if (account === undefined) {
        throw new Error(
          `Case ${entry.id} player ${player.alias} has no resolved account.`,
        );
      }
      const linked =
        player.linkedMember === undefined
          ? undefined
          : members.find((member) => member.username === player.linkedMember);
      return {
        alias: player.alias,
        account,
        discordId: player.linkedToAsker ? asker.id : (linked?.id ?? null),
        feedChannelIds: player.feeds.map((name) => channelId(name)),
      };
    }),
    candidates: input.candidates,
    reports: entry.guild.reports,
    priorIntents: entry.priorTurns.flatMap((turn) =>
      turn.intent === undefined ? [] : [turn.intent],
    ),
  };
}

export function scenarioChannelId(
  world: ScenarioWorld,
  name: string,
): DiscordChannelId {
  const channel = world.channels.find((candidate) => candidate.name === name);
  if (channel === undefined) {
    throw new Error(`Scenario ${world.caseId} has no channel named ${name}.`);
  }
  return channel.id;
}

/** `{ember.riotId}` and `{ember.region}` with the resolved values. */
export function renderScenarioQuestion(
  question: string,
  world: ScenarioWorld,
): string {
  return question.replaceAll(
    /\{([a-z][a-z0-9]*)\.(riotId|region)\}/g,
    (_match, name: string, field: string) => {
      const account = world.candidates[name];
      if (account === undefined) {
        throw new Error(
          `Scenario ${world.caseId} names candidate ${name}, which was not resolved.`,
        );
      }
      return field === "riotId"
        ? `${account.gameName}#${account.tagLine}`
        : toReadableRegion(account.region);
    },
  );
}
