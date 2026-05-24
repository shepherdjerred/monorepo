import { sumBy } from "remeda";
import type { CompletedMatch } from "@scout-for-lol/data";
import { palette } from "#src/assets/colors.ts";
import { font } from "#src/assets/index.ts";
import { Splash } from "#src/html/shared/splash.tsx";
import { TierPill } from "#src/html/shared/tier-pill.tsx";
import { GradeDiamond } from "#src/html/shared/grade-diamond.tsx";
import {
  computeKda,
  findMvpIndex,
  gradeFromKda,
  heroPlayer,
} from "#src/html/shared/grade.ts";
import { SquadRow } from "#src/html/ranked-banner/squad-row.tsx";

export const BANNER_WIDTH = 4760;
export const BANNER_HEIGHT = 1500;

function CornerBracket({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  const len = "10rem";
  const thickness = "0.4rem";
  const offset = "3rem";
  const color = palette.gold[4];

  const horizontalStyle = {
    position: "absolute" as const,
    width: len,
    height: thickness,
    background: color,
    display: "flex" as const,
  };
  const verticalStyle = {
    position: "absolute" as const,
    width: thickness,
    height: len,
    background: color,
    display: "flex" as const,
  };

  return (
    <>
      <div
        style={{
          ...horizontalStyle,
          ...(corner.startsWith("t") ? { top: offset } : { bottom: offset }),
          ...(corner.endsWith("l") ? { left: offset } : { right: offset }),
        }}
      />
      <div
        style={{
          ...verticalStyle,
          ...(corner.startsWith("t") ? { top: offset } : { bottom: offset }),
          ...(corner.endsWith("l") ? { left: offset } : { right: offset }),
        }}
      />
    </>
  );
}

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString()}min ${s.toString()}s`;
}

function queueLabel(queueType: CompletedMatch["queueType"]): string {
  if (queueType === "flex") return "RANKED FLEX";
  return "RANKED SOLO";
}

function teamKills(team: CompletedMatch["teams"]["blue"]): number {
  return sumBy(team, (c) => c.kills);
}

function teamLine(team: CompletedMatch["teams"]["blue"]) {
  const k = teamKills(team);
  const d = sumBy(team, (c) => c.deaths);
  const a = sumBy(team, (c) => c.assists);
  return `${k.toString()}/${d.toString()}/${a.toString()}`;
}

export function RankedBannerReport({ match }: { match: CompletedMatch }) {
  const hero = heroPlayer(match.players);
  const heroChampion = hero.champion;
  const heroOutcome = hero.outcome;
  const heroKda = computeKda(
    heroChampion.kills,
    heroChampion.deaths,
    heroChampion.assists,
  );
  const heroGrade = gradeFromKda(heroKda);
  const mvpIndex = findMvpIndex(match.players);
  const isSolo = match.players.length === 1;
  const rankAfter = hero.rankAfterMatch;
  const titleColor =
    heroOutcome === "Victory" ? palette.gold[4] : palette.teams.red;

  return (
    <div
      style={{
        width: `${BANNER_WIDTH.toString()}px`,
        height: `${BANNER_HEIGHT.toString()}px`,
        display: "flex",
        position: "relative",
        background: palette.grey[6],
        fontFamily: font.title,
        color: palette.gold[1],
      }}
    >
      <Splash
        championName={heroChampion.championName}
        width={BANNER_WIDTH}
        height={BANNER_HEIGHT}
        vignette="left"
      />

      <CornerBracket corner="tl" />
      <CornerBracket corner="tr" />
      <CornerBracket corner="bl" />
      <CornerBracket corner="br" />

      {/* Content */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "8rem",
          justifyContent: "space-between",
        }}
      >
        {/* Top bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
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
            <span style={{ display: "flex", color: palette.grey[1] }}>·</span>
            <span style={{ display: "flex", color: palette.grey[1] }}>
              {formatDuration(match.durationInSeconds)}
            </span>
          </div>
          {rankAfter && (
            <TierPill
              oldRank={hero.rankBeforeMatch}
              newRank={rankAfter}
              fontSizeRem={3.2}
            />
          )}
        </div>

        {/* Middle — two columns */}
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "6rem",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "2rem",
            }}
          >
            <span
              style={{
                fontSize: "16rem",
                fontFamily: font.title,
                color: titleColor,
                fontWeight: 400,
                fontStyle: "italic",
                lineHeight: 1,
                display: "flex",
              }}
            >
              {heroOutcome}
            </span>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "2rem",
              }}
            >
              <span
                style={{
                  fontSize: "3.8rem",
                  color: palette.gold[1],
                  fontWeight: 500,
                  display: "flex",
                }}
              >
                {heroChampion.championName}
              </span>
              <span
                style={{
                  fontSize: "2.5rem",
                  color: palette.grey[1],
                  fontFamily: font.body,
                  display: "flex",
                }}
              >
                {hero.lane ?? "—"} ·{" "}
                {isSolo
                  ? hero.champion.riotIdGameName
                  : `${match.players.length.toString()} tracked`}
              </span>
            </div>
          </div>

          {/* Right column: solo KDA + grade, OR squad rows */}
          {isSolo ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "1.5rem",
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
                FINAL LINE
              </span>
              <span
                style={{
                  fontSize: "12rem",
                  color: palette.gold[4],
                  fontWeight: 400,
                  lineHeight: 1,
                  display: "flex",
                }}
              >
                {heroChampion.kills} / {heroChampion.deaths} /{" "}
                {heroChampion.assists}
              </span>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "2rem",
                }}
              >
                <span
                  style={{
                    fontSize: "2.6rem",
                    color: palette.grey[1],
                    fontFamily: font.body,
                    display: "flex",
                  }}
                >
                  {heroKda.toFixed(2)} KDA
                </span>
                <GradeDiamond grade={heroGrade} size={6} />
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "1.2rem",
                width: "55%",
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
                THE SQUAD — {match.players.length}
              </span>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "1rem",
                  width: "100%",
                }}
              >
                {match.players.map((p, i) => (
                  <SquadRow
                    key={p.champion.riotIdGameName + i.toString()}
                    player={p}
                    isMvp={mvpIndex === i}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            fontSize: "2.2rem",
            letterSpacing: "0.3rem",
            color: palette.grey[1],
          }}
        >
          <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
            <span style={{ color: palette.gold[4], display: "flex" }}>◆</span>
            <span style={{ display: "flex" }}>SCOUT</span>
          </div>
          <div style={{ display: "flex", gap: "2rem", alignItems: "center" }}>
            <span style={{ display: "flex" }}>
              TEAM 1 {teamLine(match.teams.blue)}
            </span>
            <span style={{ display: "flex", color: palette.grey[2] }}>—</span>
            <span
              style={{
                display: "flex",
                color: palette.gold[1],
                fontWeight: 700,
              }}
            >
              TEAM 2 {teamLine(match.teams.red)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
