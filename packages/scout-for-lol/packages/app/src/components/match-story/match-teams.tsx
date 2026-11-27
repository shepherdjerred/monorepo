import { Link } from "react-router";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import { WinRateBar } from "@scout-for-lol/design-system/domain/profile/win-rate-bar";
import {
  allParticipants,
  championLine,
  compactNumber,
  displayNameOf,
  kdaText,
  riotIdOf,
  topDamage,
  type DetailMatch,
  type DetailParticipant,
  type MatchStory,
} from "./match-model.ts";
import { MatchEveryone } from "./match-everyone.tsx";

type Team = DetailMatch["teams"][number];

function ParticipantName(props: {
  participant: DetailParticipant;
  isViewer: boolean;
}) {
  const { participant } = props;
  const alias = participant.scoutAliases.at(0);
  const name =
    alias === undefined ? riotIdOf(participant) : displayNameOf(participant);
  return (
    <span className="flex min-w-0 items-center gap-2">
      {alias === undefined ? (
        <b className="truncate font-display text-lg">{name}</b>
      ) : (
        <Link
          to={`/players/${alias.playerId.toString()}`}
          className="min-w-0 hover:text-scout-brand"
        >
          <b className="block truncate font-display text-lg">{name}</b>
        </Link>
      )}
      {alias === undefined || props.isViewer ? null : (
        <span className="shrink-0 rounded-full bg-[var(--scout-surface-inset)] px-2 py-0.5 text-sm font-semibold">
          Friend
        </span>
      )}
    </span>
  );
}

function TeamRow(props: { participant: DetailParticipant; maxDamage: number }) {
  const { participant, maxDamage } = props;
  const share =
    maxDamage > 0 ? (participant.damageToChampions / maxDamage) * 100 : 0;
  return (
    <li
      className={`grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-1 rounded-2xl px-3 py-2 sm:grid-cols-[46px_minmax(0,1fr)_auto_8rem] ${participant.selectedPlayer ? "bg-[var(--scout-brand-soft)]" : ""}`}
      data-selected={participant.selectedPlayer ? "true" : undefined}
    >
      <ChampionFace
        champion={participant.championName}
        size={46}
        alt=""
        className="row-span-2 self-start sm:row-span-1"
      />
      <span className="grid min-w-0 leading-snug">
        <ParticipantName
          participant={participant}
          isViewer={participant.selectedPlayer}
        />
        <span className="truncate text-scout-subtle">
          {championLine(participant)}
        </span>
      </span>
      <b className="text-right font-display text-lg whitespace-nowrap">
        {kdaText(participant)}
        <span className="scout-sr-only">
          {`: ${participant.kills.toString()} kills, ${participant.deaths.toString()} deaths, ${participant.assists.toString()} assists`}
        </span>
      </b>
      <span className="col-start-2 col-end-4 flex items-center gap-2.5 sm:col-start-auto sm:col-end-auto">
        <WinRateBar
          value={share}
          variant="bar"
          showValue={false}
          you={participant.selectedPlayer}
          label={`Damage to champions ${participant.damageToChampions.toLocaleString("en-US")}`}
          className="min-w-0 flex-1"
        />
        <span className="w-12 shrink-0 text-right text-scout-subtle tabular-nums">
          {compactNumber(participant.damageToChampions)}
          <span className="scout-sr-only"> damage</span>
        </span>
      </span>
    </li>
  );
}

function TeamColumn(props: {
  title: string;
  team: Team;
  showResult: boolean;
  maxDamage: number;
}) {
  return (
    <div>
      <div className="flex min-h-7 items-center justify-between gap-3">
        <span className="flex items-center gap-2.5">
          <h3 className="text-base font-semibold text-scout-subtle">
            {props.title}
          </h3>
          {props.showResult && props.team.win ? (
            <span className="rounded-full bg-[var(--scout-win-soft)] px-2.5 py-0.5 text-sm font-semibold">
              Won
            </span>
          ) : null}
        </span>
        <span className="hidden text-scout-subtle sm:inline">Damage</span>
      </div>
      <ul className="-mx-3 mt-2 grid gap-0.5">
        {props.team.participants.map((participant, index) => (
          <TeamRow
            key={
              participant.participantId ??
              `${props.team.teamId.toString()}:${index.toString()}`
            }
            participant={participant}
            maxDamage={props.maxDamage}
          />
        ))}
      </ul>
    </div>
  );
}

function teamTitle(
  match: DetailMatch,
  team: Team,
  viewer: DetailParticipant,
  index: number,
): string {
  if (match.teams.length !== 2) return `Team ${(index + 1).toString()}`;
  return team.teamId === viewer.teamId ? "Your team" : "Their team";
}

/** Both teams, the viewer's first; everyone's build and stats fold away. */
export function MatchTeams(props: {
  match: DetailMatch;
  viewer: DetailParticipant;
  story: MatchStory | undefined;
}) {
  const { match, viewer } = props;
  const maxDamage = Math.max(
    0,
    ...allParticipants(match).map((p) => p.damageToChampions),
  );
  const teams = match.teams.toSorted(
    (left, right) =>
      Number(right.teamId === viewer.teamId) -
      Number(left.teamId === viewer.teamId),
  );
  const best = topDamage(match);
  return (
    <Panel asChild>
      <section aria-labelledby="match-teams-title">
        <h2 id="match-teams-title" className="font-display text-2xl font-bold">
          Both teams
        </h2>
        {best === null ? null : (
          <p className="mt-2 text-scout-subtle">
            {displayNameOf(best)} did the most damage to champions.
          </p>
        )}
        <div className="mt-5 grid gap-x-11 gap-y-6 min-[1181px]:grid-cols-2">
          {teams.map((team, index) => (
            <TeamColumn
              key={team.teamId}
              title={teamTitle(match, team, viewer, index)}
              team={team}
              showResult={!match.remake}
              maxDamage={maxDamage}
            />
          ))}
        </div>
        <MatchEveryone teams={teams} story={props.story} />
      </section>
    </Panel>
  );
}
