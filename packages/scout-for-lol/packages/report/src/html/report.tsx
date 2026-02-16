import { leaguePointsDelta, lpDiffToString } from "@scout-for-lol/data";
import type { CompletedMatch } from "@scout-for-lol/data";
import { palette } from "@scout-for-lol/report/assets/colors.ts";
import { RankedBadge } from "@scout-for-lol/report/html/ranked/index.tsx";
import { renderTeam } from "@scout-for-lol/report/html/team.tsx";
import { round } from "remeda";
import { font } from "@scout-for-lol/report/assets/index.ts";

export function Report({ match }: { match: CompletedMatch }) {
  const minutes = round(match.durationInSeconds / 60, 0);

  // Use the first player for summary fields (backwards compatible)
  const mainPlayer = match.players[0];
  const wins = mainPlayer?.wins;
  const losses = mainPlayer?.losses;

  // Highlight all relevant players by name
  const highlightNames = match.players.map((p) => p.champion.riotIdGameName);

  const hasSingleTrackedPlayer = match.players.length === 1;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
      }}
    >
      <div
        style={{
          display: "flex",
          padding: "5rem",
          color: palette.grey[1],
          background: `linear-gradient(90deg, ${palette.blue.gradient.dark.start} 0%, ${palette.blue.gradient.dark.end} 50%, ${palette.blue.gradient.dark.start} 100%)`,
          flexDirection: "column",
          fontSize: "5rem",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: font.title,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            alignSelf: "flex-start",
            marginBottom: "5rem",
            width: "100%",
          }}
        >
          <div
            style={{
              fontSize: "12rem",
              display: "flex",
              gap: "10rem",
              alignItems: "flex-end",
              justifyContent: "space-between",
              alignSelf: "flex-start",
            }}
          >
            <span style={{ color: palette.gold[4] }}>
              {mainPlayer?.outcome}
            </span>
            <div
              style={{
                fontSize: "6rem",
                display: "flex",
                marginBottom: "1rem",
              }}
            >
              {minutes}min {match.durationInSeconds % 60}s
            </div>
            <div
              style={{
                display: "flex",
                gap: "2rem",
                fontSize: "4rem",
                color: palette.grey[1],
                marginBottom: "1.5rem",
              }}
            >
              <span>
                {/* Check both before and after a match; this handles placements */}
                {mainPlayer?.rankBeforeMatch &&
                  mainPlayer.rankAfterMatch &&
                  lpDiffToString(
                    leaguePointsDelta(
                      mainPlayer.rankBeforeMatch,
                      mainPlayer.rankAfterMatch,
                    ),
                  )}
              </span>
              {wins !== undefined && losses !== undefined && (
                <div
                  style={{
                    display: "flex",
                    gap: "2rem",
                  }}
                >
                  <span>Wins: {wins}</span>
                  <span>Losses: {losses}</span>
                </div>
              )}
            </div>
          </div>
          {match.queueType === "clash" || match.queueType === "aram clash" ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "4rem",
                color: palette.gold[4],
                backgroundColor: palette.blue.gradient.dark.end,
                padding: "1rem 2rem",
                borderRadius: "1.5rem",
                border: `0.3rem solid ${palette.gold[4]}`,
                fontWeight: "bold",
                marginBottom: "1.5rem",
              }}
            >
              {match.queueType === "clash" ? "CLASH" : "ARAM CLASH"}
            </div>
          ) : hasSingleTrackedPlayer && mainPlayer?.rankAfterMatch ? (
            <RankedBadge
              oldRank={mainPlayer.rankBeforeMatch}
              newRank={mainPlayer.rankAfterMatch}
            />
          ) : (
            // Multiple tracked players - show all badges with scaled style
            match.players.some((p) => p.rankAfterMatch) && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  gap: "4rem",
                  alignItems: "flex-end",
                }}
              >
                {match.players
                  .filter((p) => p.rankAfterMatch)
                  .map((player) => (
                    <div
                      key={player.champion.riotIdGameName}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "0rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "3.5rem",
                          color: palette.gold[1],
                          textAlign: "center",
                          marginBottom: "-2rem",
                        }}
                      >
                        {player.champion.riotIdGameName}
                      </span>
                      {player.rankAfterMatch && (
                        <RankedBadge
                          oldRank={player.rankBeforeMatch}
                          newRank={player.rankAfterMatch}
                          scale={0.78}
                        />
                      )}
                    </div>
                  ))}
              </div>
            )
          )}
        </div>
        <div
          style={{
            width: "100%",
            display: "flex",
            gap: "6rem",
            flexDirection: "column",
          }}
        >
          {renderTeam(
            match.teams.blue,
            "blue",
            highlightNames,
            match.durationInSeconds / 60,
          )}
          {renderTeam(
            match.teams.red,
            "red",
            highlightNames,
            match.durationInSeconds / 60,
          )}
        </div>
      </div>
    </div>
  );
}
