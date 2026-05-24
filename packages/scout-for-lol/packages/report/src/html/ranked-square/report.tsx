import { leaguePointsDelta } from "@scout-for-lol/data";
import type { CompletedMatch } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { Splash } from "#src/html/shared/splash.tsx";
import { GradeDiamond } from "#src/html/shared/grade-diamond.tsx";
import { PlayerCard } from "#src/html/ranked-square/player-card.tsx";
import { ScoreBar } from "#src/html/ranked-square/score-bar.tsx";
import {
  computeKda,
  findMvpIndex,
  gradeFromKda,
  heroPlayer,
} from "#src/html/shared/grade.ts";

export const SQUARE_WIDTH = 4760;
export const SQUARE_HEIGHT = 4760;

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString()}min ${s.toString()}s`;
}

function queueLabel(queueType: CompletedMatch["queueType"]): string {
  if (queueType === "flex") return "RANKED FLEX";
  return "RANKED SOLO";
}

function squadCardWidth(playerCount: number): string {
  return `${(100 / playerCount - 1.5).toString()}%`;
}

function HeroCard({
  player,
  isWin,
  winningTeam,
}: {
  player: CompletedMatch["players"][number];
  isWin: boolean;
  winningTeam: "blue" | "red";
}) {
  const {
    kills,
    deaths,
    assists,
    championName,
    riotIdGameName,
    damage,
    creepScore,
  } = player.champion;
  const kda = computeKda(kills, deaths, assists);
  const grade = gradeFromKda(kda);
  const teamLabel = winningTeam === "blue" ? "Team 1" : "Team 2";
  const damageK = (damage / 1000).toFixed(1);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "5rem",
        padding: "4rem 6rem",
        background: "rgba(1, 10, 19, 0.7)",
        border: `0.3rem solid ${palette.gold[5]}`,
        borderRadius: "1.5rem",
        width: "100%",
        fontFamily: font.title,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flexGrow: 1,
          gap: "1rem",
        }}
      >
        <span
          style={{
            fontSize: "4.5rem",
            color: palette.gold[1],
            fontWeight: 500,
            display: "flex",
          }}
        >
          {riotIdGameName}
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1.5rem",
            fontSize: "2.4rem",
            color: palette.grey[1],
            fontFamily: font.body,
          }}
        >
          <span style={{ color: palette.gold[4], display: "flex" }}>△</span>
          <span style={{ display: "flex" }}>{championName}</span>
          <span style={{ display: "flex" }}>·</span>
          <span style={{ display: "flex" }}>
            {teamLabel} {isWin ? "Win" : "Loss"}
          </span>
        </div>
        <span
          style={{
            fontSize: "10rem",
            color: palette.gold[4],
            fontStyle: "italic",
            lineHeight: 1,
            marginTop: "1rem",
            display: "flex",
          }}
        >
          {kills}/{deaths}/{assists}
        </span>
        <span
          style={{
            fontSize: "2.4rem",
            color: palette.grey[1],
            fontFamily: font.body,
            display: "flex",
            marginTop: "0.5rem",
          }}
        >
          {kda.toFixed(2)} KDA · {damageK}k dmg · {creepScore} CS
        </span>
      </div>
      <GradeDiamond grade={grade} size={14} />
    </div>
  );
}

export function RankedSquareReport({ match }: { match: CompletedMatch }) {
  const hero = heroPlayer(match.players);
  const heroOutcome = hero.outcome;
  const isWin = heroOutcome === "Victory";
  const isSolo = match.players.length === 1;
  const mvpIndex = findMvpIndex(match.players);
  const rankAfter = hero.rankAfterMatch;
  const winningTeam: "blue" | "red" = isWin
    ? hero.team
    : hero.team === "blue"
      ? "red"
      : "blue";
  const titleColor = isWin ? palette.gold[4] : palette.teams.red;

  const wins = match.players.filter((p) => p.outcome === "Victory").length;
  const losses = match.players.length - wins;

  const lpDelta =
    hero.rankBeforeMatch && rankAfter
      ? leaguePointsDelta(hero.rankBeforeMatch, rankAfter)
      : undefined;

  const heroBandHeight = Math.floor(SQUARE_HEIGHT * 0.45);

  return (
    <div
      style={{
        width: `${SQUARE_WIDTH.toString()}px`,
        height: `${SQUARE_HEIGHT.toString()}px`,
        display: "flex",
        flexDirection: "column",
        background: palette.grey[6],
        fontFamily: font.title,
        color: palette.gold[1],
      }}
    >
      {/* Hero band — splash + title + tier pill, ~45% of canvas */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: `${SQUARE_WIDTH.toString()}px`,
          height: `${heroBandHeight.toString()}px`,
          position: "relative",
          padding: "8rem",
          justifyContent: "space-between",
        }}
      >
        <Splash
          championName={hero.champion.championName}
          width={SQUARE_WIDTH}
          height={heroBandHeight}
          vignette="both"
        />

        {/* Top bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2rem",
              fontSize: "3rem",
              letterSpacing: "0.4rem",
              color: palette.gold[1],
            }}
          >
            <span style={{ color: palette.gold[4], display: "flex" }}>◆</span>
            <span style={{ display: "flex" }}>
              {queueLabel(match.queueType)}
            </span>
          </div>
          {rankAfter && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "0.5rem",
                fontFamily: font.title,
              }}
            >
              <span
                style={{
                  fontSize: "2.2rem",
                  letterSpacing: "0.4rem",
                  color: palette.gold[2],
                  display: "flex",
                }}
              >
                RANK
              </span>
              <span
                style={{
                  fontSize: "4rem",
                  color: palette.gold[1],
                  letterSpacing: "0.3rem",
                  display: "flex",
                }}
              >
                {rankAfter.tier.toUpperCase()}
              </span>
              <span
                style={{
                  fontSize: "2.2rem",
                  color: palette.grey[1],
                  display: "flex",
                }}
              >
                {rankAfter.division === 1
                  ? "I"
                  : rankAfter.division === 2
                    ? "II"
                    : rankAfter.division === 3
                      ? "III"
                      : "IV"}
              </span>
            </div>
          )}
        </div>

        {/* Title block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "2rem",
            position: "relative",
          }}
        >
          <span
            style={{
              fontSize: "22rem",
              color: titleColor,
              fontStyle: "italic",
              fontWeight: 400,
              lineHeight: 1,
              display: "flex",
            }}
          >
            {heroOutcome}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "3rem",
              fontSize: "3.4rem",
            }}
          >
            <span style={{ color: palette.grey[1], display: "flex" }}>
              {formatDuration(match.durationInSeconds)}
            </span>
            {lpDelta !== undefined && (
              <span style={{ color: palette.blue[2], display: "flex" }}>
                {lpDelta >= 0 ? "+" : ""}
                {lpDelta} LP
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Body — squad cards or hero card */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "5rem 8rem 3rem",
          gap: "3rem",
          flexGrow: 1,
        }}
      >
        {isSolo ? (
          <HeroCard player={hero} isWin={isWin} winningTeam={winningTeam} />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2rem",
              padding: "3rem",
              background: "rgba(1, 10, 19, 0.55)",
              border: `0.25rem solid ${palette.gold[5]}`,
              borderRadius: "1.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "2.4rem",
                letterSpacing: "0.4rem",
                color: palette.gold[2],
              }}
            >
              <div
                style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}
              >
                <span style={{ color: palette.gold[4], display: "flex" }}>
                  ◆
                </span>
                <span style={{ display: "flex" }}>
                  TRACKED SQUAD — {match.players.length}
                </span>
              </div>
              <span style={{ display: "flex", color: palette.grey[1] }}>
                {wins}W / {losses}L
              </span>
            </div>
            <div
              style={{
                display: "flex",
                gap: "1.5rem",
                width: "100%",
              }}
            >
              {match.players.map((p, i) => (
                <PlayerCard
                  key={p.champion.riotIdGameName + i.toString()}
                  player={p}
                  isMvp={mvpIndex === i}
                  width={squadCardWidth(match.players.length)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Commentary */}
        {match.commentary !== undefined && match.commentary.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.5rem",
              padding: "3rem 4rem",
              borderLeft: `0.4rem solid ${palette.blue[2]}`,
              background: "rgba(10, 200, 185, 0.06)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1.5rem",
                fontSize: "2.2rem",
                letterSpacing: "0.4rem",
                color: palette.blue[2],
                fontFamily: font.title,
              }}
            >
              <span style={{ display: "flex" }}>+</span>
              <span style={{ display: "flex" }}>SCOUT</span>
            </div>
            <span
              style={{
                fontSize: "3rem",
                color: palette.gold[1],
                fontFamily: font.body,
                display: "flex",
                lineHeight: 1.3,
              }}
            >
              {match.commentary}
            </span>
          </div>
        )}

        {/* Bottom score bar */}
        <ScoreBar match={match} winningTeam={winningTeam} />
      </div>
    </div>
  );
}
