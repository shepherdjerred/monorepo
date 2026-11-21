import { useState } from "react";
import { LayoutGridIcon, ListIcon, SearchIcon } from "lucide-react";
import { useLocation } from "react-router";
import { KEEPING_COPY } from "#client/presentation/keeping.ts";
import { Choice } from "#client/ui/choice.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Segmented } from "#client/ui/segmented.tsx";
import styles from "./library.module.css";
import {
  DEFAULT_VIEW,
  KEEPING,
  KINDS,
  libraryViewSearch,
  QUERY_LIMIT,
  SORTS,
  STATUSES,
  type LibraryView,
} from "./view.ts";

const cx = classNames(styles);

const KIND_OPTIONS = {
  all: "Films and series",
  movie: "Films",
  series: "Series",
} as const satisfies Record<LibraryView["kind"], string>;
const KEEPING_OPTIONS = {
  all: "Any keeping",
  keep: KEEPING_COPY.keep,
  temporary: KEEPING_COPY.temporary,
  unclassified: KEEPING_COPY.unclassified,
} as const satisfies Record<LibraryView["keeping"], string>;
const STATUS_OPTIONS = {
  all: "Ready or not",
  available: "Ready to watch",
  unavailable: "Not ready yet",
} as const satisfies Record<LibraryView["status"], string>;
const SORT_OPTIONS = {
  title: "A to Z",
  added: "Recently added",
} as const satisfies Record<LibraryView["sort"], string>;

/**
 * The search field. It keeps its own text so typing never waits on the
 * address, and takes the address's text again whenever something else
 * changes it (Back, a cleared filter).
 */
function TitleSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const [text, setText] = useState(query);
  const { key } = useLocation();
  const [syncedTo, setSyncedTo] = useState(key);
  if (syncedTo !== key) {
    setSyncedTo(key);
    if (text.trim() !== query) setText(query);
  }
  return (
    <label className={cx("search")}>
      <SearchIcon aria-hidden="true" />
      <span className="sr-only">Search the library by title</span>
      <input
        type="search"
        placeholder="Search the library"
        value={text}
        maxLength={QUERY_LIMIT}
        enterKeyHint="search"
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.trim());
        }}
      />
    </label>
  );
}

/** Search, the three filters, the sort, and the grid or list choice. */
export function LibraryToolbar({
  view,
  onChange,
}: {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
}) {
  return (
    <div className={cx("toolbar")}>
      <TitleSearch
        query={view.query}
        onChange={(query) => {
          onChange({ ...view, query });
        }}
      />
      <div className={cx("choices")} role="group" aria-label="Filters">
        <Choice
          label="Films or series"
          value={view.kind}
          values={KINDS}
          labels={KIND_OPTIONS}
          resting={DEFAULT_VIEW.kind}
          onChange={(kind) => {
            onChange({ ...view, kind });
          }}
        />
        <Choice
          label="How long it is kept"
          value={view.keeping}
          values={KEEPING}
          labels={KEEPING_OPTIONS}
          resting={DEFAULT_VIEW.keeping}
          onChange={(keeping) => {
            onChange({ ...view, keeping });
          }}
        />
        <Choice
          label="Ready to watch or not"
          value={view.status}
          values={STATUSES}
          labels={STATUS_OPTIONS}
          resting={DEFAULT_VIEW.status}
          onChange={(status) => {
            onChange({ ...view, status });
          }}
        />
      </div>
      <div className={cx("arrange")}>
        <Choice
          label="Sort by"
          value={view.sort}
          values={SORTS}
          labels={SORT_OPTIONS}
          resting={view.sort}
          onChange={(sort) => {
            onChange({ ...view, sort });
          }}
        />
        <Segmented
          label="Layout"
          marks="true"
          segments={[
            {
              label: "Posters",
              icon: LayoutGridIcon,
              to: { search: libraryViewSearch({ ...view, layout: "grid" }) },
              current: view.layout === "grid",
            },
            {
              label: "Compact list",
              icon: ListIcon,
              to: { search: libraryViewSearch({ ...view, layout: "list" }) },
              current: view.layout === "list",
            },
          ]}
        />
      </div>
    </div>
  );
}
