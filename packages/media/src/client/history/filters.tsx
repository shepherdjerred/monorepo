import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { PlaybackPeopleSchema } from "#shared/household/playback.ts";
import { readApi } from "#client/api.ts";
import { Choice } from "#client/ui/choice.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DateField } from "#client/ui/date-field.tsx";
import { SearchField } from "#client/ui/search-field.tsx";
import styles from "./history.module.css";
import {
  dayStart,
  EVERYTHING,
  historySearch,
  isFiltered,
  localDay,
  SEARCH_LIMIT,
  type HistoryView,
} from "./view.ts";

const cx = classNames(styles);

/** The option that narrows to nobody: every person the reader may see. */
const EVERYONE = "";
const SOURCE_LABELS = {
  all: "All sources",
  plex: "Plex",
  tautulli: "Tautulli",
} satisfies Record<HistoryView["source"], string>;

/**
 * The owner's choice of whose plays to show. The people come from their own
 * read; until it answers, the person the address names is still the one
 * chosen.
 */
function PersonChoice({
  person,
  onChange,
}: {
  person: string | null;
  onChange: (person: string | null) => void;
}) {
  const people = useQuery({
    queryKey: ["playback", "people"],
    queryFn: async () => readApi("/playback/people", PlaybackPeopleSchema),
  });
  if (people.error !== null) {
    return (
      <p className={cx("filterError")} role="alert">
        The list of people did not load, so plays cannot be narrowed to one
        person.
      </p>
    );
  }
  const known = people.data ?? [];
  const names: Record<string, string> = { [EVERYONE]: "Everyone" };
  for (const each of known) names[each.id] = each.displayName;
  // A person the address names before, or without, being in the list.
  if (person !== null) names[person] ??= "One person";
  return (
    <Choice
      label="Whose plays"
      value={person ?? EVERYONE}
      values={Object.keys(names)}
      labels={names}
      resting={EVERYONE}
      onChange={(chosen) => {
        onChange(chosen === EVERYONE ? null : chosen);
      }}
    />
  );
}

/**
 * What narrows the statistics and the list: a title search, for the owner
 * one person, a source, and a span of days. Each change takes effect at once and
 * rewrites the address, so a narrowed history can be linked and reloaded.
 */
export function HistoryFilters({
  view,
  owner,
  onChange,
}: {
  view: HistoryView;
  owner: boolean;
  /** Given only what changed. */
  onChange: (change: Partial<HistoryView>) => void;
}) {
  return (
    <div className={cx("filters")} role="group" aria-label="Filters">
      <div className={cx("search")}>
        <SearchField
          label="Search the watch history by title"
          placeholder="Search by title"
          query={view.search}
          limit={SEARCH_LIMIT}
          onChange={(search) => {
            onChange({ search });
          }}
        />
      </div>
      {owner && (
        <PersonChoice
          person={view.person}
          onChange={(person) => {
            onChange({ person });
          }}
        />
      )}
      <Choice
        label="History source"
        value={view.source}
        values={["all", "plex", "tautulli"]}
        labels={SOURCE_LABELS}
        resting="all"
        onChange={(source) => {
          onChange({ source });
        }}
      />
      <DateField
        label="From"
        name="From this day"
        narrows
        value={localDay(view.from)}
        onChange={(day) => {
          onChange({ from: dayStart(day) });
        }}
      />
      <DateField
        label="Before"
        name="Before this day"
        narrows
        value={localDay(view.to)}
        onChange={(day) => {
          onChange({ to: dayStart(day) });
        }}
      />
      {isFiltered(view) && (
        <Link
          className={cx("clear")}
          to={{ search: historySearch(EVERYTHING) }}
          replace
          preventScrollReset
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}
