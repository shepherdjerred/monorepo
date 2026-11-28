import { RankCrest, type ScoutRank } from "@scout-for-lol/design-system/assets";
import { NameText } from "@scout-for-lol/design-system/domain/profile/name-text";
import { PersonInitial } from "@scout-for-lol/design-system/domain/profile/person-initial";
import { Link } from "react-router";

/**
 * A friend who is in a game now, as a row that links on: their initial with
 * the live dot, their name, what they are playing and, when Scout holds one,
 * their rank. A friend with no rank on record shows none rather than
 * "Unranked", which would be a claim.
 */
export function LiveFriendLine(props: {
  to: string;
  name: string;
  line: string;
  rank?: { crest: ScoutRank; label: string };
}) {
  return (
    <Link
      to={props.to}
      className="grid grid-cols-[46px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-[var(--scout-radius-pill)] py-[7px] pr-5 pl-3 hover:bg-[var(--scout-surface-inset)] max-[720px]:grid-cols-[46px_minmax(0,1fr)] max-[720px]:rounded-[var(--scout-radius-panel)]"
    >
      <PersonInitial name={props.name} live />
      <span className="grid min-w-0 leading-snug">
        <b className="font-display text-xl">
          <NameText>{props.name}</NameText>
        </b>
        <span className="font-semibold">{props.line}</span>
      </span>
      {props.rank === undefined ? null : (
        <span className="flex items-center gap-2 max-[720px]:col-start-2">
          <RankCrest rank={props.rank.crest} width={44} alt="" />
          <b className="font-display text-lg whitespace-nowrap">
            {props.rank.label}
          </b>
        </span>
      )}
    </Link>
  );
}
