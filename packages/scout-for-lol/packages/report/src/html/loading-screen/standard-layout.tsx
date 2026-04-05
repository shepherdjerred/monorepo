import type { LoadingScreenData } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { PlayerCard } from "#src/html/loading-screen/player-card.tsx";

export function StandardLayout({ data }: { data: LoadingScreenData }) {
  const blueTeam = data.participants.filter((p) => p.team === "blue");
  const redTeam = data.participants.filter((p) => p.team === "red");

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "40px",
        width: "100%",
      }}
    >
      {/* Blue team column */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span
          style={{
            fontSize: "14px",
            fontFamily: font.title,
            fontWeight: 700,
            color: palette.teams.blue,
            textTransform: "uppercase",
            letterSpacing: "2px",
            textAlign: "center",
            marginBottom: "4px",
          }}
        >
          Blue Team
        </span>
        {blueTeam.map((participant) => (
          <PlayerCard
            key={participant.puuid}
            participant={participant}
            teamSide="blue"
          />
        ))}
      </div>

      {/* VS divider */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
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
      </div>

      {/* Red team column */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        <span
          style={{
            fontSize: "14px",
            fontFamily: font.title,
            fontWeight: 700,
            color: palette.teams.red,
            textTransform: "uppercase",
            letterSpacing: "2px",
            textAlign: "center",
            marginBottom: "4px",
          }}
        >
          Red Team
        </span>
        {redTeam.map((participant) => (
          <PlayerCard
            key={participant.puuid}
            participant={participant}
            teamSide="red"
          />
        ))}
      </div>
    </div>
  );
}
