import { Link } from "react-router";
import {
  LibraryBrowsePageSchema,
  type LibraryPageSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import {
  libraryEntry,
  libraryItem,
} from "@shepherdjerred/streambot/web/client/media/media-items.ts";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import { useBrowseGuild, useParamState } from "./browse-state.ts";
import { FilterBar, SelectFilter, TextFilter } from "./filters.tsx";
import {
  groupSeasons,
  libraryUrl,
  readLibraryFilters,
  seasonTitle,
} from "./library-query.ts";
import { PageHeading } from "./page-heading.tsx";
import { Pager } from "./pager.tsx";
import { PAGE_SIZE } from "./paging.ts";
import "@shepherdjerred/streambot/web/client/styles/home.css";

type Entries = ReturnType<typeof LibraryPageSchema.parse>["items"];

/** The episodes of one series, a section per season. */
function Seasons(props: { items: Entries; onRetry: () => void }) {
  const groups = groupSeasons(props.items);
  if (groups.length === 0)
    return <p className="empty-note">No episodes match these filters.</p>;
  return groups.map((group) => (
    <ItemSection
      key={String(group.season)}
      title={seasonTitle(group.season)}
      load={{ status: "done", data: group.items }}
      onRetry={props.onRetry}
      items={(items) => items.map((item) => libraryEntry(item))}
      empty=""
    />
  ));
}

export function LibraryPage() {
  const guildId = useBrowseGuild();
  const { params, update, href } = useParamState();
  const filters = readLibraryFilters(params);
  const inSeries = filters.series !== "";
  const load = useLoad(
    guildId === "" ? null : libraryUrl(guildId, filters),
    LibraryBrowsePageSchema,
  );
  const page = load.state.status === "done" ? load.state.data : null;
  const noun = inSeries ? "episodes" : "titles";
  return (
    <div className="page">
      <PageHeading
        title={inSeries ? filters.series : "Library"}
        aside={inSeries ? <Link to="/library">All titles</Link> : undefined}
      />
      <FilterBar label="Library filters">
        <TextFilter
          label="Filter by title"
          placeholder="A movie, show, or episode"
          value={filters.query}
          onApply={(value) => {
            update({ q: value });
          }}
        />
        <SelectFilter
          label="Collection"
          value={filters.library}
          options={[
            { value: "", label: "All collections" },
            ...(page?.libraries ?? []).map((name) => ({
              value: name,
              label: name,
            })),
          ]}
          onChange={(value) => {
            update({ library: value });
          }}
        />
        <SelectFilter
          label="Series"
          value={filters.series}
          options={[
            { value: "", label: "All titles" },
            ...(page?.series ?? []).map((name) => ({
              value: name,
              label: name,
            })),
          ]}
          onChange={(value) => {
            update({ series: value });
          }}
        />
      </FilterBar>
      {page !== null && (
        <p className="section-note">
          {page.total} {noun}
        </p>
      )}
      {inSeries && page !== null && !("view" in page) ? (
        <Seasons items={page.items} onRetry={load.retry} />
      ) : (
        <ItemSection
          title={inSeries ? "Episodes" : "Titles"}
          layout={page !== null && "view" in page ? "cards" : "rows"}
          load={load.state}
          onRetry={load.retry}
          items={(data) => data.items.map((item) => libraryItem(item))}
          empty={
            inSeries
              ? "No episodes match these filters."
              : "Nothing in the library matches these filters."
          }
        />
      )}
      <Pager
        label="Library pages"
        offset={filters.offset}
        total={page?.total ?? 0}
        size={PAGE_SIZE}
        hrefFor={(offset) => href({ offset: String(offset) })}
      />
    </div>
  );
}
