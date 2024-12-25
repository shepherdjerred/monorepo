import React from "https://esm.sh/react@18.2.0";
import {
  CompletedMatch,
  leaguePointsDelta,
  lpDiffToString,
} from "@discord/data";
// @deno-types="npm:@types/lodash"
import _ from "npm:lodash@4.17.21";
import "https://esm.sh/react@18.2.0";
import { palette } from "../assets/colors.ts";
import { RankedBadge } from "./ranked/index.tsx";
import { renderTeam } from "./team.tsx";

export function Report({ match }: { match: CompletedMatch }) {
  const minutes = _.round(match.durationInSeconds / 60);

  if (!match.teams.red || !match.teams.blue) {
    throw new Error(
      `Match must have both teams: ${JSON.stringify(match.teams)}`
    );
  }

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
          fontFamily: "Beaufort for LOL",
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
              {match.player.outcome}
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
                {lpDiffToString(
                  leaguePointsDelta(
                    match.player.rankBeforeMatch,
                    match.player.rankAfterMatch
                  )
                )}
              </span>
              <span>Wins: {match.player.wins}</span>
              <span>Losses: {match.player.losses}</span>
            </div>
          </div>
          <RankedBadge
            oldRank={match.player.rankBeforeMatch}
            newRank={match.player.rankAfterMatch}
          />
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
            match.player.champion.championName,
            match.durationInSeconds / 60
          )}
          {renderTeam(
            match.teams.red,
            "red",
            match.player.champion.championName,
            match.durationInSeconds / 60
          )}
        </div>
      </div>
    </div>
  );
}
