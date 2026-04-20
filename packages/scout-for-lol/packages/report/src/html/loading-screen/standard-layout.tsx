import type { LoadingScreenData } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { PlayerCard } from "#src/html/loading-screen/player-card.tsx";

function TeamRow({
  participants,
  teamSide,
  label,
}: {
  participants: LoadingScreenData["participants"];
  teamSide: "blue" | "red";
  label: string;
}) {
  const teamColor =
    teamSide === "blue" ? palette.teams.blue : palette.teams.red;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <span
        style={{
          fontSize: "14px",
          fontFamily: font.title,
          fontWeight: 700,
          color: teamColor,
          textTransform: "uppercase",
          letterSpacing: "2px",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        {participants.map((participant) => (
          <PlayerCard
            key={participant.puuid ?? participant.summonerName}
            participant={participant}
            teamSide={teamSide}
          />
        ))}
      </div>
    </div>
  );
}

export function StandardLayout({ data }: { data: LoadingScreenData }) {
  const blueTeam = data.participants.filter((p) => p.team === "blue");
  const redTeam = data.participants.filter((p) => p.team === "red");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "24px",
        width: "100%",
      }}
    >
      <TeamRow participants={blueTeam} teamSide="blue" label="Blue Team" />

      {/* VS divider */}
      <span
        style={{
          fontSize: "36px",
          fontFamily: font.title,
          fontWeight: 800,
          color: palette.gold[4],
          textShadow: `0 0 20px ${palette.gold[4]}40`,
        }}
      >
        VS
      </span>

      <TeamRow participants={redTeam} teamSide="red" label="Red Team" />
    </div>
  );
}
