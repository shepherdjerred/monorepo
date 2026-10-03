import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  LibraryPageSchema,
  SearchResultsSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { api, elapsed } from "./api.ts";
import { MediaRow, type MediaListProps, type Selection } from "./media-row.tsx";
import { Sports } from "./sports.tsx";

export function MediaList(props: MediaListProps) {
  const [tab, setTab] = useState<"library" | "search" | "sports">("library");
  return (
    <section className="discovery panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">MAKE SOME NOISE</p>
          <h1>What’s playing?</h1>
          <p className="muted">Find something good. Share it in Discord.</p>
        </div>
        <span className="section-mark" aria-hidden="true">
          ↗
        </span>
      </div>
      <div className="tabs" role="tablist" aria-label="Media discovery">
        <button
          role="tab"
          aria-selected={tab === "library"}
          onClick={() => {
            setTab("library");
          }}
        >
          Library
        </button>
        <button
          role="tab"
          aria-selected={tab === "search"}
          onClick={() => {
            setTab("search");
          }}
        >
          Search & links
        </button>
        <button
          role="tab"
          aria-selected={tab === "sports"}
          onClick={() => {
            setTab("sports");
          }}
        >
          Live sports
        </button>
      </div>
      {tab === "library" ? (
        <Library {...props} />
      ) : tab === "search" ? (
        <Search {...props} />
      ) : (
        <Sports {...props} />
      )}
    </section>
  );
}

function Library(props: MediaListProps) {
  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState("");
  const [series, setSeries] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<z.infer<typeof LibraryPageSchema> | null>(
    null,
  );
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
      });
      try {
        const next = await api(
          "/api/library?" + params.toString(),
          LibraryPageSchema,
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
      <div className="filters">
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search the library"
            placeholder="Search your library…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="filter-label">
          Collection
          <select
            value={library}
            onChange={(event) => {
              setLibrary(event.target.value);
              setOffset(0);
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
              setSeries(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">All titles</option>
            {page?.series.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="result-heading">
        <span>
          {loading
            ? "Finding your media…"
            : String(page?.total ?? 0) + " titles"}
        </span>
        <span>YOUR COLLECTION</span>
      </div>
      {error !== "" && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {page?.items.length === 0 && (
        <div className="empty">
          <span aria-hidden="true">♫</span>
          <h3>No titles here yet</h3>
          <p>Try another search or collection.</p>
        </div>
      )}
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
              {...props}
            />
          </div>
        ))}
      </div>
      {page !== null && page.total > 50 && (
        <div className="pagination">
          <button
            disabled={offset === 0 || loading}
            onClick={() => {
              setOffset(Math.max(0, offset - 50));
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
              setOffset(offset + 50);
            }}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}

function Search(props: MediaListProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("auto");
  const [results, setResults] = useState<z.infer<
    typeof SearchResultsSchema
  > | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState<Selection | null>(null);
  async function search() {
    setError("");
    setResults(null);
    setLink(null);
    if (/^https?:\/\//u.test(query.trim())) {
      setLink({ kind: "url", url: query.trim() });
      return;
    }
    setLoading(true);
    try {
      setResults(
        await api(
          "/api/search?" +
            new URLSearchParams({
              guildId: props.guildId,
              query,
              source,
            }).toString(),
          SearchResultsSchema,
        ),
      );
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="search-field">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Title or media URL"
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
            setSource(event.target.value);
          }}
        >
          <option value="auto">All sources</option>
          <option value="youtube">YouTube</option>
          <option value="local">Local library</option>
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
          title="Play this link"
          detail={query}
          selection={link}
          {...props}
        />
      )}
      {results?.map((item) => (
        <MediaRow
          key={item.id}
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
          {...(item.artworkUrl === undefined
            ? {}
            : { artworkUrl: item.artworkUrl })}
          {...props}
        />
      ))}
      {results?.length === 0 && (
        <div className="empty">
          <h3>No matches</h3>
          <p>Try a different title or source.</p>
        </div>
      )}
      {results === null && link === null && !loading && (
        <div className="empty">
          <span aria-hidden="true">↗</span>
          <h3>A whole internet of possibilities</h3>
          <p>Search for a title or paste a supported media link.</p>
        </div>
      )}
    </>
  );
}
