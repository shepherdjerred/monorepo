import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { RankCrest } from "@scout-for-lol/design-system/assets";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import { NameText } from "@scout-for-lol/design-system/domain/profile/name-text";
import { AssetIcon } from "@scout-for-lol/design-system/domain/rows/asset-icon";
import { Link } from "react-router";
import {
  championLine,
  displayName,
  orderedTeams,
  rankCrestTier,
  rankLabel,
  rankOf,
  type LiveGameData,
  type LiveParticipant,
} from "#src/lib/live/live-game.ts";
import { runeItem, spellItem } from "#src/lib/live/live-kit.ts";

function Rank(props: { participant: LiveParticipant }) {
  const rank = rankOf(props.participant);
  if (rank === null) return <span />;
  return (
    <span className="flex items-center gap-1 text-[15px] leading-tight whitespace-nowrap">
      <RankCrest
        rank={rankCrestTier(rank)}
        width={36}
        alt=""
        className="-my-1 -ml-1.5 flex-none"
      />
      {rankLabel(rank)}
    </span>
  );
}

function Kit(props: { participant: LiveParticipant }) {
  const { participant } = props;
  const spells = [participant.spell1Id, participant.spell2Id].map((id) =>
    spellItem(id),
  );
  const keystone =
    participant.keystoneId === null ? null : runeItem(participant.keystoneId);
  return (
    <span className="flex items-center gap-1">
      {spells.map((spell) => (
        <AssetIcon
          key={spell.name}
          asset={spell.asset}
          label={spell.name}
          className="size-[26px] flex-none overflow-hidden rounded-md"
        />
      ))}
      {keystone === null ? null : (
        <AssetIcon
          asset={keystone.asset}
          label={keystone.name}
          className="ml-1 size-[26px] flex-none overflow-hidden rounded-full bg-[var(--scout-color-overlay)]"
        />
      )}
    </span>
  );
}

function Who(props: { participant: LiveParticipant }) {
  const { participant } = props;
  const name = displayName(participant);
  const { friend } = participant;
  return (
    <span className="grid min-w-0 leading-snug max-[720px]:col-span-2">
      <span className="flex min-w-0 items-center gap-2">
        {friend === null ? (
          <b className="min-w-0 font-display text-[19px]">
            <NameText>{name}</NameText>
          </b>
        ) : (
          <Link
            to={`/players/${friend.playerId.toString()}`}
            className="inline-flex min-w-0 hover:text-scout-brand max-[720px]:min-h-11 max-[720px]:items-center"
          >
            <b className="min-w-0 font-display text-[19px]">
              <NameText>{name}</NameText>
            </b>
          </Link>
        )}
        {friend === null ? null : (
          <span className="flex-none rounded-full bg-[var(--scout-surface-inset-strong)] px-2.5 text-[13px] leading-5 font-semibold text-scout-subtle">
            Friend
          </span>
        )}
      </span>
      <span className="truncate text-scout-subtle">
        {championLine(participant)}
      </span>
    </span>
  );
}

function LobbyRow(props: { participant: LiveParticipant }) {
  const { participant } = props;
  return (
    <li
      className={`grid grid-cols-[46px_minmax(0,1fr)_124px_auto] items-center gap-x-3.5 gap-y-1 rounded-full py-[7px] pr-4 pl-3 max-[720px]:grid-cols-[46px_minmax(0,1fr)_auto] max-[720px]:rounded-[var(--scout-radius-panel)] max-[720px]:py-2.5 ${
        participant.friend === null ? "" : "bg-[var(--scout-surface-inset)]"
      }`}
    >
      <ChampionFace
        champion={participant.championId}
        alt=""
        className="max-[720px]:row-span-2 max-[720px]:self-start"
      />
      <Who participant={participant} />
      <Rank participant={participant} />
      <Kit participant={participant} />
    </li>
  );
}

/** Both teams, five rows each, with the friends marked. */
export function LiveLobby(props: { game: LiveGameData }) {
  return (
    <Panel asChild>
      <section aria-labelledby="teams-h">
        <h2
          id="teams-h"
          className="m-0 font-display text-2xl leading-tight font-bold"
        >
          Both teams
        </h2>
        <div className="mt-4 grid gap-x-11 gap-y-6 min-[1181px]:grid-cols-2">
          {orderedTeams(props.game).map((team) => (
            <div key={team.teamId} className="min-w-0">
              <h3 className="m-0 min-h-7 text-[15px] leading-7 font-semibold text-scout-subtle">
                {team.title}
              </h3>
              <ul className="m-0 mt-2 -mx-3 grid list-none gap-0.5 p-0 max-[720px]:-mx-2.5">
                {team.participants.map((participant, index) => (
                  <LobbyRow
                    key={participant.riotId ?? `seat-${index.toString()}`}
                    participant={participant}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </Panel>
  );
}
