import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useRouteState, pageOffset, PAGE_TITLES } from "./route-state.ts";
import { History } from "./history.tsx";
import type { z } from "zod";
import {
  LibraryBrowsePageSchema,
  SearchResultsSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { api, elapsed } from "./api.ts";
import { MediaRow, type MediaListProps, type Selection } from "./media-row.tsx";
import { Sports } from "./sports.tsx";
import { PosterCard } from "./poster-card.tsx";

export function MediaList(props: MediaListProps) {
  const { pathname } = useLocation();
  const { params } = useRouteState();
  const context = new URLSearchParams();
  for (const key of ["guild", "channel"]) {
    const value = params.get(key);
    if (value !== null) context.set(key, value);
  }
  const title = PAGE_TITLES[pathname] ?? "Page not found";
  return (
    <section className="discovery panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MAKE SOME NOISE</p>
          <h1 tabIndex={-1} id="page-heading">
            {title}
          </h1>
          <p className="muted">Find something good. Share it in Discord.</p>
        </div>
        <span className="section-mark" aria-hidden="true">
          ↗
        </span>
      </div>
      <nav className="tabs" aria-label="Media discovery">
        {[
          ["/plex", "Plex"],
          ["/search", "Search & links"],
          ["/sports", "Live sports"],
          ["/history", "History"],
        ].map(([path, label]) => (
          <NavLink
            key={path}
            to={
              String(path) +
              (context.size === 0 ? "" : "?" + context.toString())
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {pathname === "/plex" ? (
        <Library key={props.guildId} {...props} />
      ) : pathname === "/search" ? (
        <Search key={props.guildId} {...props} />
      ) : pathname === "/sports" ? (
        <Sports key={props.guildId} {...props} />
      ) : pathname === "/history" ? (
        <History key={props.guildId} {...props} />
      ) : (
        <p>
          This page does not exist. <Link to="/plex">Browse Plex</Link>
        </p>
      )}
    </section>
  );
}

function Library(props: MediaListProps) {
  const route = useRouteState();
  const query = route.params.get("q") ?? "";
  const library = route.params.get("library") ?? "";
  const series = route.params.get("series") ?? "";
  const offset = pageOffset(route.params.get("offset"));
  const [draft, setDraft] = useState(query);
  useEffect(() => {
    setDraft(query);
  }, [query]);
  const [page, setPage] = useState<z.infer<
    typeof LibraryBrowsePageSchema
  > | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setPage(null);
    async function loadPage() {
      const params = new URLSearchParams({
        guildId: props.guildId,
        query,
        library,
        series,
        offset: String(offset),
        view: series === "" ? "titles" : "entries",
      });
      try {
        const next = await api(
          "/api/library?" + params.toString(),
          LibraryBrowsePageSchema,
          {
            signal: controller.signal,
          },
        );
        if (!controller.signal.aborted) setPage(next);
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            error_ instanceof Error ? error_.message : "Library unavailable.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    const timer = setTimeout(() => {
      void loadPage();
    }, 200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [props.guildId, query, library, series, offset]);

  return (
    <>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          route.update({ q: draft.trim(), offset: "" });
        }}
      >
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search Plex"
            placeholder="Search Plex…"
            name="q"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
        </label>
        <label className="filter-label">
          Collection
          <select
            value={library}
            onChange={(event) => {
              route.update({ library: event.target.value, offset: "" });
            }}
          >
            <option value="">All collections</option>
            {page?.libraries.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="filter-label">
          Series
          <select
            value={series}
            onChange={(event) => {
              route.update({
                series: event.target.value,
                fromLibrary: "",
                offset: "",
              });
            }}
          >
            <option value="">All titles</option>
            {page?.series.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <button type="submit">Search</button>
      </form>
      <div className="result-heading">
        <span>
          {loading
            ? "Finding your media…"
            : String(page?.total ?? 0) +
              (series === "" ? " titles" : " episodes")}
        </span>
        <span>YOUR COLLECTION</span>
      </div>
      {series !== "" && (
        <div className="series-navigation">
          <Link
            to={route.href({
              series: "",
              library: route.params.get("fromLibrary") ?? library,
              fromLibrary: "",
              offset: "",
            })}
          >
            ← All titles
          </Link>
          <span>{series}</span>
        </div>
      )}
      {error !== "" && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {page?.items.length === 0 && (
        <div className="empty">
          <span aria-hidden="true">♫</span>
          <h3>
            {series === "" ? "No titles here yet" : "No episodes here yet"}
          </h3>
          <p>Try another search or collection.</p>
        </div>
      )}
      <LibraryResults
        page={page}
        library={library}
        route={route}
        controls={props}
      />
      {page !== null && page.total > 50 && (
        <div className="pagination">
          <button
            disabled={offset === 0 || loading}
            onClick={() => {
              route.update({ offset: String(Math.max(0, offset - 50)) });
            }}
          >
            Previous
          </button>
          <span>
            {offset + 1}–{Math.min(offset + 50, page.total)} of {page.total}
          </span>
          <button
            disabled={offset + 50 >= page.total || loading}
            onClick={() => {
              route.update({ offset: String(offset + 50) });
            }}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

function LibraryResults({
  page,
  library,
  route,
  controls,
}: {
  page: z.infer<typeof LibraryBrowsePageSchema> | null;
  library: string;
  route: ReturnType<typeof useRouteState>;
  controls: MediaListProps;
}) {
  return (
    <>
      {" "}
      {page !== null && "view" in page ? (
        <div className="poster-grid">
          {page.items.map((item) => (
            <PosterCard
              key={item.id}
              item={item}
              {...controls}
              openSeries={(name, collection) => {
                route.update({
                  fromLibrary: library,
                  series: name,
                  library: collection,
                  offset: "",
                });
              }}
              seriesHref={(name, collection) =>
                route.href({
                  fromLibrary: library,
                  series: name,
                  library: collection,
                  offset: "",
                })
              }
            />
          ))}
        </div>
      ) : (
        <div className="media-rows">
          {page?.items.map((item, index) => (
            <div key={item.id}>
              {item.series !== undefined &&
                (index === 0 ||
                  page.items[index - 1]?.series !== item.series ||
                  page.items[index - 1]?.season !== item.season) && (
                  <h3 className="series-heading">
                    {item.series} <span>Season {item.season}</span>
                  </h3>
                )}
              <MediaRow
                title={item.title}
                detail={[
                  item.library,
                  item.year,
                  item.episode === undefined
                    ? undefined
                    : "Episode " + String(item.episode),
                ]
                  .filter((value) => value !== undefined)
                  .join(" · ")}
                selection={{ kind: "library", id: item.id }}
                {...(item.artworkUrl === undefined
                  ? {}
                  : { artworkUrl: item.artworkUrl })}
                {...controls}
              />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function Search(props: MediaListProps) {
  const route = useRouteState();
  const submitted = route.params.get("q") ?? "";
  const source = route.params.get("source") ?? "auto";
  const [query, setQuery] = useState(submitted);
  const [results, setResults] = useState<z.infer<
    typeof SearchResultsSchema
  > | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const link: Selection | null = /^https?:\/\//u.test(submitted)
    ? { kind: "url", url: submitted }
    : null;
  useEffect(() => {
    setQuery(submitted);
  }, [submitted]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setResults(null);
    if (submitted === "" || /^https?:\/\//u.test(submitted)) {
      setLoading(false);
      return;
    }
    setLoading(true);
    async function load() {
      try {
        const next = await api(
          "/api/search?" +
            new URLSearchParams({
              guildId: props.guildId,
              query: submitted,
              source,
            }).toString(),
          SearchResultsSchema,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) setResults(next);
      } catch (caughtError) {
        if (!controller.signal.aborted)
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Search failed.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, [props.guildId, submitted, source]);
  return (
    <>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          route.update({ q: query.trim() });
        }}
      >
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Title or media URL"
            name="q"
            placeholder="A song, a video, or a link…"
            required
            maxLength={300}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <select
          aria-label="Search source"
          value={source}
          onChange={(event) => {
            route.update({ source: event.target.value });
          }}
        >
          <option value="auto">All sources</option>
          <option value="youtube">YouTube</option>
          <option value="local">Plex</option>
          <option value="history">History</option>
        </select>
        <button className="primary" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>
      {error !== "" && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {link !== null && (
        <MediaRow
          {...props}
          title="Play this link"
          detail={submitted}
          selection={link}
        />
      )}
      {results?.map((item) => (
        <MediaRow
          key={item.id}
          {...props}
          title={item.title}
          detail={[
            item.provider,
            item.channel,
            item.durationSeconds === undefined
              ? undefined
              : elapsed(item.durationSeconds),
          ]
            .filter((value) => value !== undefined)
            .join(" · ")}
          selection={{ kind: "candidate", id: item.id }}
          landscape={item.provider === "youtube"}
          {...(item.artworkUrl === undefined
            ? {}
            : { artworkUrl: item.artworkUrl })}
        />
      ))}
      {results?.length === 0 && (
        <div className="empty">
          <h3>No matches</h3>
          <p>Try a different title or source.</p>
        </div>
      )}
      {results === null && link === null && !loading && error === "" && (
        <div className="empty">
          <span aria-hidden="true">↗</span>
          <h3>A whole internet of possibilities</h3>
          <p>Search for a title or paste a supported media link.</p>
        </div>
      )}
    </>
  );
}
