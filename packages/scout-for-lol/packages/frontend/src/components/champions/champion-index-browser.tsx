import { useState } from "react";
import { LaneIcon } from "@scout-for-lol/design-system/assets";
import { Chip } from "@scout-for-lol/design-system/components/surfaces/chip";
import { ChampionCard } from "@scout-for-lol/design-system/domain/rows/champion-card";
import {
  visibleCards,
  type IndexCard,
  type IndexRole,
  type IndexSort,
} from "#src/components/champions/index-model.ts";

/**
 * The controls of the champions index: how the list is sorted, which role it
 * shows and a search. The server renders the whole list in its default order,
 * so the page reads the same before this island hydrates.
 */

const SORTS: readonly { value: IndexSort; label: string }[] = [
  { value: "strongest", label: "Strongest first" },
  { value: "lane", label: "Best in lane" },
];

const ROLES: readonly {
  value: IndexRole;
  label: string;
  icon: string | null;
}[] = [
  { value: "all", label: "All", icon: null },
  { value: "TOP", label: "Top", icon: "top" },
  { value: "JUNGLE", label: "Jungle", icon: "jungle" },
  { value: "MIDDLE", label: "Mid", icon: "middle" },
  { value: "BOTTOM", label: "Bot", icon: "adc" },
  { value: "UTILITY", label: "Support", icon: "support" },
];

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="9" cy="9" r="5.5" />
      <path d="m13.5 13.5 3.5 3.5" />
    </svg>
  );
}

export function ChampionIndexBrowser(props: { cards: readonly IndexCard[] }) {
  const [sort, setSort] = useState<IndexSort>("strongest");
  const [role, setRole] = useState<IndexRole>("all");
  const [query, setQuery] = useState("");
  const shown = visibleCards(props.cards, { sort, role, query });

  return (
    <section className="champions-open ix-all" aria-labelledby="all-h">
      <div className="champions-head">
        <h2 id="all-h">All champions</h2>
        <div className="champions-controls" role="group" aria-label="Sort by">
          {SORTS.map((entry) => (
            <Chip
              key={entry.value}
              pressed={sort === entry.value}
              onClick={() => {
                setSort(entry.value);
              }}
            >
              {entry.label}
            </Chip>
          ))}
        </div>
      </div>
      <div className="champions-head ix-bar">
        <div className="champions-controls" role="group" aria-label="Role">
          {ROLES.map((entry) => (
            <Chip
              key={entry.value}
              pressed={role === entry.value}
              onClick={() => {
                setRole(entry.value);
              }}
            >
              {entry.icon === null ? null : (
                <LaneIcon lane={entry.icon} alt="" className="champions-lane" />
              )}
              {entry.label}
            </Chip>
          ))}
        </div>
        <form
          className="ix-find"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <label className="scout-sr-only" htmlFor="find-any">
            Find a champion
          </label>
          <SearchIcon />
          <input
            id="find-any"
            name="champion"
            type="search"
            placeholder="Find a champion"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
            }}
          />
        </form>
      </div>
      <p className="scout-sr-only" role="status">
        {shown.length.toString()}{" "}
        {shown.length === 1 ? "champion" : "champions"}
      </p>
      {shown.length === 0 ? (
        <p className="champions-quiet">No champion matches</p>
      ) : (
        <ul className="champions-cards">
          {shown.map((card) => (
            <li key={card.href}>
              <ChampionCard
                champion={card.id}
                href={card.href}
                lane={{ label: card.roleName, icon: card.laneIcon }}
                winRate={card.winRate}
                games={card.games}
                tier={`${card.tier} tier`}
                {...(card.lane === null
                  ? {}
                  : {
                      laneWinRate: card.lane.aheadRate,
                      laneGames: card.lane.games,
                    })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
