import { useHref } from "react-router";
import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { GameSentenceRow } from "@scout-for-lol/design-system/domain/rows/game-sentence-row";
import { BuildGroup } from "./match-build-list.tsx";
import { builtItems, builtRunes, builtSpells } from "./match-build.ts";
import {
  displayNameOf,
  type DetailParticipant,
  type StoryParticipant,
} from "./match-model.ts";

function FriendGame(props: { friend: DetailParticipant }) {
  const { friend } = props;
  const alias = friend.scoutAliases.at(0);
  // The row renders a plain anchor, so it needs the app's base path.
  const href = useHref(
    alias === undefined ? "/players" : `/players/${alias.playerId.toString()}`,
  );
  return (
    <GameSentenceRow
      result={friend.win ? "win" : "loss"}
      champion={friend.championName}
      person={displayNameOf(friend)}
      kda={{
        kills: friend.kills,
        deaths: friend.deaths,
        assists: friend.assists,
      }}
      {...(alias === undefined ? {} : { href })}
    />
  );
}

export function MatchFriends(props: { friends: readonly DetailParticipant[] }) {
  if (props.friends.length === 0) return null;
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="match-friends-title">
        <h2
          id="match-friends-title"
          className="font-display text-2xl font-bold"
        >
          With friends
        </h2>
        <ul className="mt-3 grid gap-1">
          {props.friends.map((friend) => (
            <li key={friend.participantId ?? friend.championId}>
              <FriendGame friend={friend} />
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}

/**
 * What the viewer built: items, the rune page and the summoner spells. The
 * purchase order arrives with the story; until then the final items stand.
 */
export function MatchBuild(props: {
  viewer: DetailParticipant;
  story: StoryParticipant | undefined;
}) {
  const items = builtItems(props.viewer, props.story);
  const runes = builtRunes(props.viewer);
  return (
    <Panel variant="open" asChild>
      <section aria-labelledby="match-build-title">
        <h2 id="match-build-title" className="font-display text-2xl font-bold">
          Build
        </h2>
        <div className="mt-4 grid gap-6">
          {items.items.length === 0 ? null : (
            <BuildGroup
              title="Items"
              items={items.items}
              ordered={items.sequence}
            />
          )}
          {runes.length === 0 ? null : (
            <BuildGroup title="Runes" items={runes} />
          )}
          <BuildGroup
            title="Summoner spells"
            items={builtSpells(props.viewer)}
          />
        </div>
      </section>
    </Panel>
  );
}
