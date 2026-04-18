import type {
  LoadingScreenData,
  LoadingScreenParticipant,
} from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { PlayerCard } from "#src/html/loading-screen/player-card.tsx";

type ArenaTeam = {
  teamKey: number;
  players: LoadingScreenParticipant[];
};

function groupIntoArenaTeams(
  participants: LoadingScreenParticipant[],
): ArenaTeam[] {
  const teamMap = new Map<number, LoadingScreenParticipant[]>();

  for (const participant of participants) {
    // For arena, team is { arenaTeam: 1..8 }
    if (typeof participant.team === "string") {
      throw new TypeError(
        `Arena layout received standard team "${participant.team}" — expected arena team object`,
      );
    }
    const teamNum = participant.team.arenaTeam;
    const existing = teamMap.get(teamNum) ?? [];
    existing.push(participant);
    teamMap.set(teamNum, existing);
  }

  return [...teamMap.entries()]
    .map(([teamKey, players]) => ({ teamKey, players }))
    .toSorted((a, b) => a.teamKey - b.teamKey);
}

function TeamPair({ team, teamIndex }: { team: ArenaTeam; teamIndex: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
      }}
    >
      <span
        style={{
          fontSize: "12px",
          fontFamily: font.title,
          fontWeight: 700,
          color: palette.gold[2],
          textTransform: "uppercase",
          letterSpacing: "1px",
        }}
      >
        Team {(teamIndex + 1).toString()}
      </span>
      <div style={{ display: "flex", gap: "6px" }}>
        {team.players.map((participant) => (
          <PlayerCard
            key={participant.puuid ?? participant.summonerName}
            participant={participant}
            teamSide="neutral"
          />
        ))}
      </div>
    </div>
  );
}

export function ArenaLayout({ data }: { data: LoadingScreenData }) {
  const teams = groupIntoArenaTeams(data.participants);

  // Arrange in 4 rows x 2 columns
  const rows: ArenaTeam[][] = [];
  for (let i = 0; i < teams.length; i += 2) {
    const first = teams[i];
    if (first === undefined) {
      continue;
    }
    const row: ArenaTeam[] = [first];
    const second = teams[i + 1];
    if (second !== undefined) {
      row.push(second);
    }
    rows.push(row);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "16px",
        width: "100%",
      }}
    >
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx.toString()}
          style={{
            display: "flex",
            gap: "40px",
            justifyContent: "center",
          }}
        >
          {row.map((team, colIdx) => (
            <TeamPair
              key={team.teamKey.toString()}
              team={team}
              teamIndex={rowIdx * 2 + colIdx}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
