import { LayoutGridIcon, ListIcon } from "lucide-react";
import { KEEPING_COPY } from "#client/presentation/keeping.ts";
import { Choice } from "#client/ui/choice.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { SearchField } from "#client/ui/search-field.tsx";
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
      <div className={cx("search")}>
        <SearchField
          label="Search the library by title"
          placeholder="Search the library"
          query={view.query}
          limit={QUERY_LIMIT}
          onChange={(query) => {
            onChange({ ...view, query });
          }}
        />
      </div>
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
