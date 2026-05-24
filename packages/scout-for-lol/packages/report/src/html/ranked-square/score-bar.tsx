import { sumBy } from "remeda";
import { getChampionImage } from "#src/dataDragon/image-cache.ts";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import type { CompletedMatch } from "@scout-for-lol/data";

const ICON_REM = 6;

function CompIcons({ team }: { team: CompletedMatch["teams"]["blue"] }) {
  return (
    <div style={{ display: "flex", gap: "0.8rem" }}>
      {team.map((champion, idx) => (
        <div
          key={champion.riotIdGameName + idx.toString()}
          style={{
            width: `${ICON_REM.toString()}rem`,
            height: `${ICON_REM.toString()}rem`,
            display: "flex",
            overflow: "hidden",
            borderRadius: "0.4rem",
            border: `0.15rem solid ${palette.gold[5]}`,
          }}
        >
          <img
            src={getChampionImage(champion.championName)}
            alt=""
            width={ICON_REM * 16}
            height={ICON_REM * 16}
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </div>
      ))}
    </div>
  );
}

export function ScoreBar({
  match,
  winningTeam,
}: {
  match: CompletedMatch;
  winningTeam: "blue" | "red";
}) {
  const blueKills = sumBy(match.teams.blue, (c) => c.kills);
  const redKills = sumBy(match.teams.red, (c) => c.kills);
  const blueWon = winningTeam === "blue";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "2rem 0",
        borderTop: `0.2rem solid ${palette.gold[5]}`,
        fontFamily: font.title,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          flexGrow: 1,
        }}
      >
        <CompIcons team={match.teams.blue} />
        <div
          style={{
            display: "flex",
            height: "0.25rem",
            background: palette.blue[2],
            width: "100%",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "3rem",
          padding: "0 3rem",
          fontSize: "5rem",
          color: palette.gold[4],
          fontStyle: "italic",
        }}
      >
        {blueWon && (
          <span
            style={{
              fontSize: "2.2rem",
              letterSpacing: "0.3rem",
              color: palette.blue[2],
              display: "flex",
              marginRight: "1rem",
            }}
          >
            WIN
          </span>
        )}
        <span style={{ display: "flex" }}>{blueKills}</span>
        <span style={{ display: "flex", color: palette.grey[1] }}>—</span>
        <span style={{ display: "flex" }}>{redKills}</span>
        {!blueWon && (
          <span
            style={{
              fontSize: "2.2rem",
              letterSpacing: "0.3rem",
              color: palette.teams.red,
              display: "flex",
              marginLeft: "1rem",
            }}
          >
            WIN
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          flexGrow: 1,
        }}
      >
        <CompIcons team={match.teams.red} />
        <div
          style={{
            display: "flex",
            height: "0.25rem",
            background: palette.teams.red,
            width: "100%",
          }}
        />
      </div>
    </div>
  );
}
