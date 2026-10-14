import { useState } from "react";
import type { GameId } from "@arcade/common/catalog.ts";
import {
  characterName,
  courseName,
  stageName,
} from "@arcade/common/metadata.ts";
import type {
  CompletedRound,
  CourseRecord,
  Standing,
  Stats,
} from "@arcade/common/stats.ts";
import { useStats } from "./session.ts";
import { Metric, Panel, duration } from "./ui/panels.tsx";

type Tab = "leaderboard" | "mine" | "history" | "records";
type RacingGame = "mk64" | "mkwii";

export function Statistics({
  guildId,
  gameId,
  viewerId,
}: {
  readonly guildId: string;
  readonly gameId: GameId;
  readonly viewerId: string | undefined;
}) {
  const [tab, setTab] = useState<Tab>("leaderboard");
  const query = useStats(
    guildId,
    gameId,
    tab === "mine" ? viewerId : undefined,
  );
  if (gameId === "emerald") return null;
  const racing = gameId === "mk64" || gameId === "mkwii";
  const tabs: { id: Tab; title: string }[] = [
    { id: "leaderboard", title: "Leaderboard" },
    { id: "mine", title: "My stats" },
    { id: "history", title: racing ? "Race history" : "Match history" },
  ];
  if (racing) tabs.push({ id: "records", title: "Course records" });
  return (
    <Panel
      title={racing ? "The record book" : "Versus statistics"}
      className="statistics"
    >
      <div className="tabs" role="tablist" aria-label="Statistics">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => {
              setTab(entry.id);
            }}
          >
            {entry.title}
          </button>
        ))}
      </div>
      {query.error !== null && (
        <p role="alert" className="notice">
          Could not load statistics. Try again shortly.
        </p>
      )}
      {query.isPending && <p className="empty">Opening the record book…</p>}
      {query.data !== undefined && (
        <StatisticsContent
          tab={tab}
          stats={query.data}
          gameId={gameId}
          viewerId={viewerId}
        />
      )}
    </Panel>
  );
}

function StatisticsContent({
  tab,
  stats,
  gameId,
  viewerId,
}: {
  readonly tab: Tab;
  readonly stats: Stats;
  readonly gameId: Exclude<GameId, "emerald">;
  readonly viewerId: string | undefined;
}) {
  switch (tab) {
    case "leaderboard":
      return (
        <Leaderboard
          standings={stats.leaderboard}
          racing={gameId === "mk64" || gameId === "mkwii"}
        />
      );
    case "mine": {
      if (viewerId === undefined)
        return (
          <p className="empty">
            Sign in with Discord to find your personal records.
          </p>
        );
      const mine = stats.leaderboard.find(
        (entry) => entry.player.discordId === viewerId,
      );
      return mine === undefined ? (
        <p className="empty">Finish a game to begin your record.</p>
      ) : (
        <PersonalStats
          standing={mine}
          gameId={gameId}
          records={stats.records}
        />
      );
    }
    case "history":
      return <History rounds={stats.recent} gameId={gameId} />;
    case "records": {
      if (gameId !== "mk64" && gameId !== "mkwii")
        throw new Error("Course records require a racing game");
      return <CourseRecords records={stats.records} gameId={gameId} />;
    }
  }
}

function Leaderboard({
  standings,
  racing,
}: {
  readonly standings: Standing[];
  readonly racing: boolean;
}) {
  if (standings.length === 0)
    return <p className="empty">The first result is still yours to write.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>{racing ? "Races" : "Matches"}</th>
            <th>Wins</th>
            <th>Win rate</th>
            <th>{racing ? "Average place" : "KOs"}</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((entry, index) => (
            <tr key={entry.player.discordId}>
              <td>{index + 1}</td>
              <td>
                <strong>{entry.player.name}</strong>
              </td>
              <td>{entry.played}</td>
              <td>{entry.wins}</td>
              <td>{Math.round(entry.winRate * 100)}%</td>
              <td>{racing ? entry.averagePlacement?.toFixed(2) : entry.kos}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PersonalStats({
  standing,
  gameId,
  records,
}: {
  readonly standing: Standing;
  readonly gameId: Exclude<GameId, "emerald">;
  readonly records: CourseRecord[];
}) {
  const racing = gameId === "mk64" || gameId === "mkwii";
  return (
    <div className="personal-stats">
      <h3>{standing.player.name}</h3>
      <div className="metrics">
        <Metric label={racing ? "Races" : "Matches"} value={standing.played} />
        <Metric label="Wins" value={standing.wins} />
        <Metric
          label="Win rate"
          value={String(Math.round(standing.winRate * 100)) + "%"}
        />
        <Metric
          label={racing ? "Podiums" : "KOs"}
          value={racing ? (standing.podiums ?? "—") : (standing.kos ?? "—")}
        />
        {!racing && (
          <>
            <Metric label="Falls" value={standing.falls ?? "—"} />
            <Metric
              label="Self-destructs"
              value={standing.selfDestructs ?? "—"}
            />
          </>
        )}
      </div>
      <h4>Finishing places</h4>
      <div className="placement-chart">
        {standing.placements.map((count, index) => (
          <div key={index} className="placement-column">
            <strong>{count}</strong>
            <div
              className="placement-bar"
              style={{
                height:
                  String(
                    standing.played === 0 ? 0 : (count / standing.played) * 100,
                  ) + "px",
              }}
            />
            <span>#{index + 1}</span>
          </div>
        ))}
      </div>
      <h4>Characters played</h4>
      <ul className="character-records">
        {standing.characters.map((character) => (
          <li key={character.characterId}>
            <span>{characterName(gameId, character.characterId)}</span>
            <span>
              {character.played} played · {character.wins} wins
            </span>
          </li>
        ))}
      </ul>
      {racing && (
        <>
          <h4>Personal course records</h4>
          <CourseRecords
            records={records.filter(
              (record) => record.player.discordId === standing.player.discordId,
            )}
            gameId={gameId}
          />
        </>
      )}
    </div>
  );
}

function CourseRecords({
  records,
  gameId,
}: {
  readonly records: CourseRecord[];
  readonly gameId: RacingGame;
}) {
  if (records.length === 0)
    return <p className="empty">Finish a course to set its first record.</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Course</th>
            <th>Mode / class</th>
            <th>Driver</th>
            <th>Character</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {records
            .toSorted((a, b) => a.courseId - b.courseId || a.timeMs - b.timeMs)
            .map((record, index) => (
              <tr key={index}>
                <td>{courseName(gameId, record.courseId)}</td>
                <td>
                  {modeName(record.mode)} {record.engineClass}{" "}
                  {record.mirror === true ? "Mirror" : ""}
                </td>
                <td>{record.player.name}</td>
                <td>{characterName(gameId, record.characterId)}</td>
                <td className="mono">{duration(record.timeMs)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

function History({
  rounds,
  gameId,
}: {
  readonly rounds: CompletedRound[];
  readonly gameId: Exclude<GameId, "emerald">;
}) {
  if (rounds.length === 0)
    return <p className="empty">Completed games will appear here.</p>;
  return (
    <ol className="round-history">
      {rounds.map((round) => (
        <li key={round.id}>
          <div className="round-heading">
            <strong>{roundName(round, gameId)}</strong>
            <span>{modeName(round.mode)}</span>
            <time dateTime={round.at}>
              {new Date(round.at).toLocaleString()}
            </time>
          </div>
          <div className="round-results">
            {round.family === "racing"
              ? round.results
                  .toSorted((a, b) => a.placement - b.placement)
                  .map((result) => (
                    <span key={result.seat}>
                      <b>#{result.placement}</b>{" "}
                      {result.player?.name ?? "Unclaimed player"}
                      <small>
                        {characterName(gameId, result.characterId)} ·{" "}
                        {duration(result.timeMs)}
                      </small>
                    </span>
                  ))
              : round.results
                  .toSorted((a, b) => a.placement - b.placement)
                  .map((result) => (
                    <span key={result.seat}>
                      <b>#{result.placement}</b>{" "}
                      {result.player?.name ?? "Unclaimed player"}
                      {result.winner && " ★"}
                      <small>
                        {characterName(gameId, result.characterId)} ·{" "}
                        {result.kos} KOs · {result.falls} falls ·{" "}
                        {result.selfDestructs} SDs
                      </small>
                    </span>
                  ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

function roundName(round: CompletedRound, gameId: GameId): string {
  if (round.family === "racing" && (gameId === "mk64" || gameId === "mkwii"))
    return courseName(gameId, round.courseId);
  if (round.family === "fighting" && (gameId === "melee" || gameId === "brawl"))
    return stageName(gameId, round.stageId);
  throw new Error("Saved results do not match this game");
}

function modeName(mode: CompletedRound["mode"]): string {
  const names = {
    gp: "Grand Prix",
    versus: "Versus",
    "time-trials": "Time Trial",
    stock: "Stock",
    time: "Timed",
  };
  return names[mode];
}
