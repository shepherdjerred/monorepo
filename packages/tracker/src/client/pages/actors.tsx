import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Activity,
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarPlus,
  Clock,
  Users,
} from "lucide-react";
import { z } from "zod";
import { api } from "#client/data/api.ts";
import { EnumPicker, type EnumOption } from "#client/controls/enum-picker.tsx";
import { CollectionToolbar, withSearchParam } from "./collection-toolbar.tsx";
import {
  sortDirectionSummary,
  sortOptions,
} from "#client/controls/property-options.tsx";
import {
  listPageSize,
  useIssuePages,
} from "#client/issues/issue-list-query.ts";
import {
  defaultSortDirection,
  oppositeSortDirection,
  readDisplay,
  SortSchema,
  writeDisplay,
} from "#client/views/display-options.ts";
import { IssueListSchema } from "#shared/schema.ts";
import { Avatar, ErrorNotice } from "#client/ui/ui.tsx";
import { ActorsSkeleton } from "#client/ui/skeleton.tsx";
import { ActivityList } from "#client/issues/activity.tsx";
import { AbsoluteTime, RelativeTime } from "#client/ui/time.tsx";

const ActorDirectorySortSchema = z.enum([
  "last-seen",
  "mutations",
  "first-seen",
  "name",
  "kind",
]);
type ActorDirectorySort = z.infer<typeof ActorDirectorySortSchema>;

const actorSortOptions: (EnumOption & { value: ActorDirectorySort })[] = [
  { value: "last-seen", label: "Last seen", icon: <Clock size={14} /> },
  {
    value: "mutations",
    label: "Most mutations",
    icon: <Activity size={14} />,
  },
  {
    value: "first-seen",
    label: "First seen",
    icon: <CalendarPlus size={14} />,
  },
  { value: "name", label: "Name (A–Z)", icon: <ArrowDownAZ size={14} /> },
  { value: "kind", label: "Kind", icon: <Users size={14} /> },
];

export function Actors() {
  const key = useParams()["key"];
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const parsedDirSort = ActorDirectorySortSchema.safeParse(
    params.get("actorSort"),
  );
  const directorySort: ActorDirectorySort = parsedDirSort.success
    ? parsedDirSort.data
    : "last-seen";
  const display = readDisplay(params);

  const actors = useQuery({
    queryKey: ["actors"],
    queryFn: () => api.actors.list.query(),
  });
  const events = useQuery({
    queryKey: ["actor-events", key],
    queryFn: () => api.actors.activity.query({ actorKey: key, limit: 100 }),
    enabled: key !== undefined,
  });
  const actor = actors.data?.find((a) => a.key === key);
  // Paged like every other issue list, so edits reach these rows too.
  const created = useIssuePages(
    key === undefined
      ? undefined
      : IssueListSchema.parse({
          creatorKey: key,
          includeArchived: true,
          sort: display.sort,
          dir:
            display.sortDir === defaultSortDirection(display.sort)
              ? undefined
              : display.sortDir,
          limit: listPageSize,
        }),
  );
  const votes = useQuery({
    queryKey: ["actor-votes", key],
    queryFn: () => api.actors.votes.query({ key: key ?? "" }),
    enabled: key !== undefined,
  });

  const sortedActors = useMemo(() => {
    if (actors.data === undefined) {
      return [];
    }
    const needle = query.trim().toLowerCase();
    return actors.data
      .filter(
        (item) =>
          needle === "" ||
          item.name.toLowerCase().includes(needle) ||
          item.key.toLowerCase().includes(needle) ||
          item.kind.toLowerCase().includes(needle),
      )
      .toSorted((a, b) => {
        switch (directorySort) {
          case "last-seen": {
            return (
              b.lastSeenAt.localeCompare(a.lastSeenAt) ||
              a.key.localeCompare(b.key)
            );
          }
          case "mutations": {
            return b.seenCount - a.seenCount || a.key.localeCompare(b.key);
          }
          case "first-seen": {
            return (
              b.firstSeenAt.localeCompare(a.firstSeenAt) ||
              a.key.localeCompare(b.key)
            );
          }
          case "name": {
            return (
              a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
              a.key.localeCompare(b.key)
            );
          }
          case "kind": {
            return (
              a.kind.localeCompare(b.kind) ||
              b.seenCount - a.seenCount ||
              a.key.localeCompare(b.key)
            );
          }
        }
      });
  }, [actors.data, query, directorySort]);

  return (
    <div className="reading-page">
      {actors.error !== null && <ErrorNotice error={actors.error} />}
      {actors.data === undefined && actors.error === null ? (
        <ActorsSkeleton />
      ) : actor === undefined ? (
        <>
          <CollectionToolbar
            ariaLabel="Filter and sort actors"
            searchId="actors-search"
            searchLabel="Search actors"
            searchPlaceholder="Search actors…"
            query={query}
            onQueryChange={(value) => {
              setParams(withSearchParam(params, "q", value), {
                replace: true,
                preventScrollReset: true,
              });
            }}
            sortId="actors-sort"
            sortLabel="Sort actors"
            sortValue={directorySort}
            sortOptions={actorSortOptions}
            onSortChange={(value) => {
              const nextSort = ActorDirectorySortSchema.parse(value);
              setParams(
                withSearchParam(params, "actorSort", nextSort, "last-seen"),
                { preventScrollReset: true },
              );
            }}
          />
          <div className="actor-grid">
            {sortedActors.map((a) => (
              <Link
                className="actor-card"
                key={a.id}
                to={`/actors/${encodeURIComponent(a.key)}`}
              >
                <Avatar actor={a} decorative />
                <h2>{a.name}</h2>
                <span className="kind">{a.kind}</span>
                <code>{a.key}</code>
                <p>
                  {a.seenCount} mutations · last seen{" "}
                  <RelativeTime value={a.lastSeenAt} />
                </p>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="actor-profile">
            <Avatar actor={actor} decorative />
            <h2>{actor.name}</h2>
            <span className="kind">{actor.kind}</span>
            <code>{actor.key}</code>
            <p>
              First seen <AbsoluteTime value={actor.firstSeenAt} withTime /> ·{" "}
              {actor.seenCount} mutations
            </p>
          </div>
          <div className="metadata-grid">
            <section>
              <h3>First metadata</h3>
              <pre>{JSON.stringify(actor.firstMetadata, null, 2)}</pre>
            </section>
            <section>
              <h3>Latest metadata</h3>
              <pre>{JSON.stringify(actor.metadata, null, 2)}</pre>
            </section>
          </div>
          <section className="actor-section">
            <div className="section-heading">
              <h3>Created issues</h3>
              <div className="sort-control">
                <EnumPicker
                  id="actor-issues-sort"
                  label="Sort created issues"
                  value={display.sort}
                  options={sortOptions}
                  onChange={(value) => {
                    setParams(
                      writeDisplay(params, { sort: SortSchema.parse(value) }),
                      { preventScrollReset: true },
                    );
                  }}
                />
                <button
                  type="button"
                  className="toolbar-button sort-dir-button"
                  aria-label={`Created issues sort direction: ${sortDirectionSummary(display.sort, display.sortDir)}`}
                  onClick={() => {
                    setParams(
                      writeDisplay(params, {
                        sortDir: oppositeSortDirection(display.sortDir),
                      }),
                      { preventScrollReset: true },
                    );
                  }}
                >
                  {display.sortDir === "desc" ? (
                    <ArrowDownWideNarrow size={14} aria-hidden="true" />
                  ) : (
                    <ArrowUpNarrowWide size={14} aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            {created.error !== null && <ErrorNotice error={created.error} />}
            {created.items.map((issue) => (
              <p key={issue.id}>
                <Link to={`/issues/${issue.identifier}`}>
                  <span className="identifier">{issue.identifier}</span> ·{" "}
                  {issue.title}
                </Link>
              </p>
            ))}
            {created.moreError !== null && (
              <ErrorNotice error={created.moreError} />
            )}
            {created.hasMore && (
              <button disabled={created.loadingMore} onClick={created.loadMore}>
                {created.loadingMore ? "Loading…" : "Load more issues"}
              </button>
            )}
          </section>
          <section className="actor-section">
            <h3>Votes</h3>
            {votes.error !== null && <ErrorNotice error={votes.error} />}
            {votes.data?.map((vote) => (
              <p key={vote.identifier}>
                <Link to={`/issues/${vote.identifier}`}>
                  <span className="identifier">{vote.identifier}</span> ·{" "}
                  {vote.title}
                </Link>
                {vote.note !== null && (
                  <span className="muted"> · {vote.note}</span>
                )}
              </p>
            ))}
          </section>
          {events.data !== undefined && (
            <ActivityList events={events.data} detailed />
          )}
        </>
      )}
    </div>
  );
}
