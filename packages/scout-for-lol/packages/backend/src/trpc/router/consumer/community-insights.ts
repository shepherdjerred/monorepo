import type { LeaguePuuid } from "@scout-for-lol/domain/identity/league-account.ts";
import { isArenaQueueOrMode } from "@scout-for-lol/data";
import type { GuildMatchRow } from "#src/reports/duckdb/community/community-lake.ts";
import { isStandardRiftGame } from "#src/trpc/router/consumer/standard-rift.ts";

export type CommunityPlayer = {
  id: number;
  alias: string;
  accounts: {
    id: number;
    puuid: LeaguePuuid;
    riotGameName: string | null;
    riotTagLine: string | null;
    region: string;
  }[];
};

type Match = { id: string; at: number; rows: GuildMatchRow[] };

function groupMatches(rows: GuildMatchRow[]): Match[] {
  const byId = new Map<string, GuildMatchRow[]>();
  for (const row of rows) {
    const match = byId.get(row.match_id) ?? [];
    match.push(row);
    byId.set(row.match_id, match);
  }
  return [...byId]
    .map(([id, participants]) => ({
      id,
      at: participants[0]?.game_creation_ms ?? 0,
      rows: participants,
    }))
    .toSorted((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}

export function isStandardFiveVsFive(match: Match): boolean {
  if (
    match.rows.length !== 10 ||
    match.rows[0] === undefined ||
    !isStandardRiftGame(match.rows[0])
  )
    return false;
  const teams = new Map<number, number>();
  for (const row of match.rows)
    teams.set(row.team_id, (teams.get(row.team_id) ?? 0) + 1);
  return teams.size === 2 && [...teams.values()].every((size) => size === 5);
}

type Relation = {
  playerId: number;
  key: string;
  guildPlayerId: number | null;
  name: string;
  games: number;
  wins: number;
  lastMatchId: string;
  lastMatchMs: number;
};

function byPlayer(left: Relation, right: Relation) {
  return (
    left.playerId - right.playerId ||
    Number(right.guildPlayerId !== null) -
      Number(left.guildPlayerId !== null) ||
    right.games - left.games ||
    right.lastMatchMs - left.lastMatchMs
  );
}

function addRelation(options: {
  target: Map<string, Relation>;
  playerId: number;
  other: GuildMatchRow;
  otherPlayer: CommunityPlayer | undefined;
  win: boolean;
  match: Match;
}) {
  const { target, playerId, other, otherPlayer, win, match } = options;
  const key =
    otherPlayer === undefined
      ? `puuid:${other.puuid}`
      : `player:${otherPlayer.id.toString()}`;
  const mapKey = `${playerId.toString()}:${key}`;
  const current = target.get(mapKey);
  if (current === undefined) {
    target.set(mapKey, {
      playerId,
      key,
      guildPlayerId: otherPlayer?.id ?? null,
      name:
        otherPlayer?.alias ??
        `${other.riot_id_game_name ?? "Unknown"}#${other.riot_id_tagline}`,
      games: 1,
      wins: win ? 1 : 0,
      lastMatchId: match.id,
      lastMatchMs: match.at,
    });
  } else {
    current.games++;
    if (win) current.wins++;
  }
}

type Pair = {
  firstId: number;
  secondId: number;
  games: number;
  wins: number;
  lastMatchId: string;
  lastMatchMs: number;
};

function pairKey(firstId: number, secondId: number): string {
  return `${firstId.toString()}:${secondId.toString()}`;
}

type OwnedRow = { row: GuildMatchRow; player: CommunityPlayer };

function sameMatchTeam(left: GuildMatchRow, right: GuildMatchRow): boolean {
  const arena = isArenaQueueOrMode(left.queue_id, left.game_mode);
  if (arena !== isArenaQueueOrMode(right.queue_id, right.game_mode)) {
    throw new Error(`Match ${left.match_id} has inconsistent Arena context`);
  }
  if (!arena) return left.team_id === right.team_id;
  if (left.player_subteam_id === null || right.player_subteam_id === null) {
    throw new Error(`Arena match ${left.match_id} is missing a player subteam`);
  }
  return left.player_subteam_id === right.player_subteam_id;
}

function addPair(
  pairs: Map<string, Pair>,
  left: OwnedRow,
  right: OwnedRow,
  match: Match,
) {
  if (!sameMatchTeam(left.row, right.row) || left.player.id === right.player.id)
    return;
  const firstId = Math.min(left.player.id, right.player.id);
  const secondId = Math.max(left.player.id, right.player.id);
  const key = pairKey(firstId, secondId);
  const current = pairs.get(key);
  if (current === undefined) {
    pairs.set(key, {
      firstId,
      secondId,
      games: 1,
      wins: left.row.win ? 1 : 0,
      lastMatchId: match.id,
      lastMatchMs: match.at,
    });
  } else {
    current.games++;
    if (left.row.win) current.wins++;
  }
}

function addPairs(
  pairs: Map<string, Pair>,
  guildRows: OwnedRow[],
  match: Match,
) {
  for (let first = 0; first < guildRows.length; first++) {
    for (let second = first + 1; second < guildRows.length; second++) {
      const left = guildRows[first];
      const right = guildRows[second];
      if (left === undefined || right === undefined) continue;
      addPair(pairs, left, right, match);
    }
  }
}

type InsightsState = {
  together: Map<string, Relation>;
  rivals: Map<string, Relation>;
  pairs: Map<string, Pair>;
  rowsByPuuid: Map<string, GuildMatchRow[]>;
  coverage: Map<
    string,
    { playerId: number; role: string; champion: string; games: number }
  >;
  forms: Map<
    number,
    { games: number; wins: number; roles: Map<string, number> }
  >;
};

function addForm(state: InsightsState, owned: OwnedRow, standard: boolean) {
  const form = state.forms.get(owned.player.id) ?? {
    games: 0,
    wins: 0,
    roles: new Map<string, number>(),
  };
  if (standard && form.games < 20) {
    form.games++;
    if (owned.row.win) form.wins++;
    const role = owned.row.team_position.toUpperCase();
    form.roles.set(role, (form.roles.get(role) ?? 0) + 1);
  }
  state.forms.set(owned.player.id, form);
}

function addCoverage(state: InsightsState, owned: OwnedRow, standard: boolean) {
  if (!standard) return;
  const role = owned.row.team_position.toUpperCase();
  if (!["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].includes(role)) return;
  const key = `${owned.player.id.toString()}:${role}:${owned.row.champion_name}`;
  const current = state.coverage.get(key) ?? {
    playerId: owned.player.id,
    role,
    champion: owned.row.champion_name,
    games: 0,
  };
  current.games++;
  state.coverage.set(key, current);
}

function addRelationships(
  state: InsightsState,
  owned: OwnedRow,
  match: Match,
  playerByPuuid: Map<string, CommunityPlayer>,
) {
  const seenTogether = new Set<string>();
  const seenRivals = new Set<string>();
  for (const other of match.rows) {
    const otherPlayer = playerByPuuid.get(other.puuid);
    if (other.puuid === owned.row.puuid || otherPlayer?.id === owned.player.id)
      continue;
    const key =
      otherPlayer === undefined
        ? `puuid:${other.puuid}`
        : `player:${otherPlayer.id.toString()}`;
    const teammates = sameMatchTeam(other, owned.row);
    if (teammates && !seenTogether.has(key)) {
      addRelation({
        target: state.together,
        playerId: owned.player.id,
        other,
        otherPlayer,
        win: owned.row.win,
        match,
      });
      seenTogether.add(key);
    } else if (!teammates && !seenRivals.has(key)) {
      addRelation({
        target: state.rivals,
        playerId: owned.player.id,
        other,
        otherPlayer,
        win: owned.row.win,
        match,
      });
      seenRivals.add(key);
    }
  }
}

function processMatch(
  state: InsightsState,
  match: Match,
  playerByPuuid: Map<string, CommunityPlayer>,
) {
  const guildRows = match.rows.flatMap((row) => {
    const player = playerByPuuid.get(row.puuid);
    return player === undefined ? [] : [{ row, player }];
  });
  const uniqueGuildRows = [
    ...new Map(
      guildRows.map((entry) => [entry.player.id, entry] as const),
    ).values(),
  ];
  addPairs(state.pairs, uniqueGuildRows, match);
  const standard = isStandardFiveVsFive(match);
  for (const owned of uniqueGuildRows) {
    addForm(state, owned, standard);
    addRelationships(state, owned, match, playerByPuuid);
  }
  for (const owned of guildRows) {
    const entries = state.rowsByPuuid.get(owned.row.puuid) ?? [];
    entries.push(owned.row);
    state.rowsByPuuid.set(owned.row.puuid, entries);
    addCoverage(state, owned, standard);
  }
}

function accountForms(options: {
  players: CommunityPlayer[];
  allTimeAccounts: {
    puuid: LeaguePuuid;
    games: number;
    last_match_ms: number;
  }[];
  rowsByPuuid: Map<string, GuildMatchRow[]>;
}) {
  const allTimeByPuuid = new Map(
    options.allTimeAccounts.map((account) => [account.puuid, account] as const),
  );
  return options.players.flatMap((player) => {
    const main = player.accounts.toSorted((left, right) => {
      const leftCount = allTimeByPuuid.get(left.puuid);
      const rightCount = allTimeByPuuid.get(right.puuid);
      return (
        (rightCount?.games ?? 0) - (leftCount?.games ?? 0) ||
        (rightCount?.last_match_ms ?? 0) - (leftCount?.last_match_ms ?? 0) ||
        left.id - right.id
      );
    })[0];
    return player.accounts.map((account) => {
      const games = options.rowsByPuuid.get(account.puuid) ?? [];
      const kills = games.reduce((sum, row) => sum + row.kills, 0);
      const deaths = games.reduce((sum, row) => sum + row.deaths, 0);
      const assists = games.reduce((sum, row) => sum + row.assists, 0);
      const minutes = games.reduce((sum, row) => sum + row.time_played / 60, 0);
      return {
        playerId: player.id,
        accountId: account.id,
        riotId: `${account.riotGameName ?? "Unknown"}#${account.riotTagLine ?? "?"}`,
        region: account.region,
        isMain:
          main?.id === account.id &&
          (allTimeByPuuid.get(main.puuid)?.games ?? 0) > 0,
        games: games.length,
        wins: games.filter((row) => row.win).length,
        kda: deaths === 0 ? kills + assists : (kills + assists) / deaths,
        csPerMinute:
          minutes > 0
            ? games.reduce((sum, row) => sum + row.creep_score, 0) / minutes
            : 0,
        lastMatchMs: games[0]?.game_creation_ms ?? null,
      };
    });
  });
}

export function buildCommunityInsights(options: {
  players: CommunityPlayer[];
  rows: GuildMatchRow[];
  allTimeAccounts: {
    puuid: LeaguePuuid;
    games: number;
    last_match_ms: number;
  }[];
  standardOnly: boolean;
}) {
  const playerByPuuid = new Map(
    options.players.flatMap((player) =>
      player.accounts.map((account) => [account.puuid, player] as const),
    ),
  );
  const matches = groupMatches(options.rows).filter(
    (match) => !options.standardOnly || isStandardFiveVsFive(match),
  );
  const state: InsightsState = {
    together: new Map(),
    rivals: new Map(),
    pairs: new Map(),
    rowsByPuuid: new Map(),
    coverage: new Map(),
    forms: new Map(),
  };
  for (const match of matches) {
    processMatch(state, match, playerByPuuid);
  }
  return {
    matchCount: matches.length,
    recentlyPlayedWith: [...state.together.values()].toSorted(byPlayer),
    rivalries: [...state.rivals.values()]
      .filter((rival) => rival.guildPlayerId !== null || rival.games >= 2)
      .toSorted(byPlayer),
    pairs: [...state.pairs.values()].toSorted(
      (left, right) => right.games - left.games || left.firstId - right.firstId,
    ),
    coverage: [...state.coverage.values()].toSorted(
      (left, right) =>
        left.playerId - right.playerId ||
        left.role.localeCompare(right.role) ||
        right.games - left.games,
    ),
    accountForms: accountForms({
      players: options.players,
      allTimeAccounts: options.allTimeAccounts,
      rowsByPuuid: state.rowsByPuuid,
    }),
    forms: options.players.map((player) => {
      const form = state.forms.get(player.id) ?? {
        games: 0,
        wins: 0,
        roles: new Map<string, number>(),
      };
      return {
        playerId: player.id,
        games: form.games,
        wins: form.wins,
        strength: (form.wins + 5) / (form.games + 10),
        roles: Object.fromEntries(form.roles),
      };
    }),
  };
}

export function squadChemistry(options: {
  players: CommunityPlayer[];
  rows: GuildMatchRow[];
  playerIds: number[];
}) {
  const selected = new Set(options.playerIds);
  // Keyed by raw puuid: match rows carry every participant, tracked or not.
  const ownerByPuuid = new Map<string, number>(
    options.players.flatMap((player) =>
      player.accounts.map((account) => [account.puuid, player.id] as const),
    ),
  );
  const shared = groupMatches(options.rows)
    .filter((match) => isStandardFiveVsFive(match))
    .flatMap((match) => {
      const teamByPlayer = new Map<number, GuildMatchRow>();
      for (const row of match.rows) {
        const owner = ownerByPuuid.get(row.puuid);
        if (owner !== undefined && selected.has(owner))
          teamByPlayer.set(owner, row);
      }
      if (teamByPlayer.size !== selected.size) return [];
      const participants = [...teamByPlayer.values()];
      const teamId = participants[0]?.team_id;
      if (
        teamId === undefined ||
        !participants.every((participant) => participant.team_id === teamId)
      )
        return [];
      return [
        { matchId: match.id, at: match.at, win: participants[0]?.win ?? false },
      ];
    });
  return {
    games: shared.length,
    wins: shared.filter((match) => match.win).length,
    lowSample: shared.length < 3,
    matches: shared.slice(0, 20),
  };
}
