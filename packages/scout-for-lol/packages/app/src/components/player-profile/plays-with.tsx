import { Panel } from "@scout-for-lol/design-system/components/surfaces/panel";
import { NameText } from "@scout-for-lol/design-system/domain/profile/name-text";
import { PersonInitial } from "@scout-for-lol/design-system/domain/profile/person-initial";
import type { GameResult } from "@scout-for-lol/design-system/domain/profile/result-strip";
import { SECTION_HEADING } from "#src/components/friendly-classes.ts";
import { useSpaLink } from "#src/hooks/use-spa-link.ts";
import type {
  PlaysWith,
  PlaysWithFriend,
} from "#src/lib/player/player-page.ts";

const LOSS_RING =
  "shadow-[inset_0_0_0_2px_color-mix(in_srgb,var(--scout-color-danger-on-surface)_58%,var(--scout-color-surface))]";

/** Games together as dots: a filled one for a win, a ring for a loss. */
function Tally(props: { results: readonly GameResult[] }) {
  return (
    <span
      aria-hidden="true"
      className="col-span-full flex gap-[5px] pl-[60px] sm:col-span-1 sm:pl-0"
    >
      {props.results.map((result, index) => (
        <i
          key={`${result}-${index.toString()}`}
          className={`size-3 rounded-full ${result === "win" ? "bg-scout-win-fill" : LOSS_RING}`}
        />
      ))}
    </span>
  );
}

function Friend(props: { friend: PlaysWithFriend }) {
  const { friend } = props;
  const link = useSpaLink(`/players/${friend.playerId.toString()}`);
  return (
    <a
      href={link.href}
      onClick={link.onClick}
      className="grid grid-cols-[46px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 rounded-lg px-3.5 py-2.5 text-scout-ink no-underline hover:bg-[var(--scout-surface-inset)] hover:[&_b]:text-scout-brand sm:grid-cols-[46px_minmax(0,1fr)_auto] sm:rounded-full sm:py-[7px] sm:pr-5 sm:pl-3"
    >
      <PersonInitial name={friend.alias} />
      <span className="grid min-w-0 leading-snug">
        <b className="font-display text-xl">
          <NameText>{friend.alias}</NameText>
        </b>
        <span className="text-scout-subtle">{friend.text}</span>
      </span>
      <Tally results={friend.tally} />
    </a>
  );
}

/** The friends this player queues with, most games together first. */
export function PlaysWithPanel(props: { playsWith: PlaysWith }) {
  return (
    <Panel asChild>
      <section aria-labelledby="plays-h">
        <h2 id="plays-h" className={SECTION_HEADING}>
          Plays with
        </h2>
        <p className="m-0 mt-2.5 font-display text-[27px] leading-tight font-medium text-balance sm:text-[32px]">
          {props.playsWith.lead}
        </p>
        <ul className="m-0 mt-3.5 grid list-none gap-0.5 p-0 sm:-mx-3.5">
          {props.playsWith.friends.map((friend) => (
            <li key={friend.playerId}>
              <Friend friend={friend} />
            </li>
          ))}
        </ul>
      </section>
    </Panel>
  );
}
