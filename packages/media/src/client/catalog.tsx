import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import {
  CatalogDetailSchema,
  CatalogSearchSchema,
  CommandResultSchema,
} from "#shared/api.ts";
import type { CatalogDetail } from "#shared/api.ts";
import { LanguageSchema } from "#shared/contract.ts";
import type { MediaUser } from "#shared/contract.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
import {
  EmptyState,
  ErrorNotice,
  Loading,
  PageTitle,
  Status,
} from "./components.tsx";

const AdoptResultSchema = z.object({ mediaId: z.string() });

export function Discover() {
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const results = useQuery({
    queryKey: ["catalog", search],
    enabled: search.length > 0,
    queryFn: async () =>
      readApi(
        `/catalog/search?q=${encodeURIComponent(search)}`,
        CatalogSearchSchema,
      ),
  });
  return (
    <>
      <PageTitle
        eyebrow="Make yourself at home"
        title="What’s your next watch?"
      >
        <p>Find a film, follow a series, and we’ll take it from here.</p>
      </PageTitle>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(text.trim());
        }}
      >
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <label className="sr-only" htmlFor="catalog-search">
          Search movies and series
        </label>
        <input
          id="catalog-search"
          type="search"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
          placeholder="Search movies, series, and anime…"
          maxLength={200}
          required
        />
        <button
          className="button primary"
          type="submit"
          disabled={text.trim().length === 0 || results.isFetching}
        >
          {results.isFetching ? "Searching…" : "Search"}
        </button>
      </form>
      {search.length === 0 ? (
        <DiscoverWelcome />
      ) : (
        <>
          <div className="section-heading">
            <h2>Results for “{search}”</h2>
            <span>Movies & series</span>
          </div>
          {results.isPending && <Loading />}
          {results.error !== null && <ErrorNotice error={results.error} />}
          {results.data?.results.length === 0 && (
            <EmptyState title="No matches this time">
              Try another title or its original-language name.
            </EmptyState>
          )}
          <div className="catalog-grid">
            {results.data?.results.map((item) => (
              <Link
                className="catalog-card"
                key={`${item.kind}-${String(item.externalId)}`}
                to={`/catalog/${item.kind}/${String(item.externalId)}`}
              >
                <div className={`catalog-art art-${item.kind}`}>
                  <span>{item.kind === "movie" ? "FILM" : "SERIES"}</span>
                  <strong aria-hidden="true">{item.title.slice(0, 1)}</strong>
                  <i aria-hidden="true">↗</i>
                </div>
                <div className="card-body">
                  <h3>{item.title}</h3>
                  <p>
                    {item.date.slice(0, 4)}
                    <span>·</span>
                    {item.originalLanguage.toUpperCase()}
                  </p>
                  <p className="card-overview">{item.overview}</p>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function DiscoverWelcome() {
  return (
    <section className="welcome-card">
      <div>
        <span className="eyebrow">One request. Everything handled.</span>
        <h2>
          A little less searching.
          <br />A lot more watching.
        </h2>
        <p>
          Request something you love. We’ll find it, bring it to Plex, and let
          you know when it’s ready.
        </p>
        <Link className="text-link" to="/requests">
          See your requests <span aria-hidden="true">→</span>
        </Link>
      </div>
      <div className="welcome-illustration" aria-hidden="true">
        <div className="mini-cover cover-back">SERIES</div>
        <div className="mini-cover cover-front">
          YOUR
          <br />
          NEXT
          <br />
          <em>FAVORITE.</em>
        </div>
        <span className="spark">✦</span>
      </div>
    </section>
  );
}

export function CatalogPage({ user }: { user: MediaUser }) {
  const { kind, id } = useParams();
  const valid =
    (kind === "movie" || kind === "series") &&
    id !== undefined &&
    /^\d+$/.test(id);
  const detail = useQuery({
    queryKey: ["catalog-detail", kind, id],
    enabled: valid,
    queryFn: async () =>
      readApi(`/catalog/${String(kind)}/${String(id)}`, CatalogDetailSchema),
  });
  if (!valid)
    return (
      <EmptyState title="This title could not be found">
        Return to Discover to find a movie or series.
      </EmptyState>
    );
  if (detail.isPending) return <Loading />;
  if (detail.error !== null) return <ErrorNotice error={detail.error} />;
  const item = detail.data;
  return (
    <>
      <Link className="back-link" to="/">
        ← Discover
      </Link>
      <PageTitle
        eyebrow={`${item.kind === "movie" ? "Film" : "Series"} · ${item.date.slice(0, 4)}`}
        title={item.title}
      >
        <p>{item.overview}</p>
      </PageTitle>
      <div className="detail-columns">
        <section className="panel">
          <h2>Make it part of your library</h2>
          <p className="muted">
            We’ll notify you when it’s ready to watch in Plex.
          </p>
          <RequestForm user={user} item={item} />
          {item.kind === "series" && <ChooseEpisodes user={user} item={item} />}
        </section>
        <section className="panel">
          <h2>
            {item.kind === "movie" ? "About this film" : "Available seasons"}
          </h2>
          <dl className="facts">
            <div>
              <dt>Original language</dt>
              <dd>{item.originalLanguage.toUpperCase()}</dd>
            </div>
            <div>
              <dt>First release</dt>
              <dd>{item.date}</dd>
            </div>
          </dl>
          {item.seasons.map((season) => (
            <div className="list-row" key={season.externalId}>
              <span>{season.title}</span>
              <Status value={`${String(season.episodeCount)} episodes`} />
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function ChooseEpisodes({
  user,
  item,
}: {
  user: MediaUser;
  item: CatalogDetail;
}) {
  const navigate = useNavigate();
  const adopt = useMutation({
    mutationFn: async () =>
      writeApi({
        actorId: user.id,
        path: "/catalog/adopt",
        body: { kind: item.kind, externalId: item.externalId },
        schema: AdoptResultSchema,
      }),
    onSuccess: (result) => {
      void navigate(`/media/${encodeURIComponent(result.mediaId)}`);
    },
  });
  return (
    <div className="contact-settings">
      <button
        className="button subtle"
        disabled={adopt.isPending || user.restricted}
        onClick={() => {
          adopt.mutate();
        }}
      >
        {adopt.isPending
          ? "Loading episodes…"
          : "Choose individual seasons or episodes"}
      </button>
      {adopt.error !== null && <ErrorNotice error={adopt.error} />}
    </div>
  );
}

function RequestForm({ user, item }: { user: MediaUser; item: CatalogDetail }) {
  const navigate = useNavigate();
  const [languages, setLanguages] = useState("en");
  const [future, setFuture] = useState(item.kind === "series");
  const [specials, setSpecials] = useState(false);
  const request = useMutation({
    mutationFn: async () => {
      const subtitleLanguages = z
        .array(LanguageSchema)
        .max(20)
        .parse(
          languages
            .split(",")
            .map((language) => language.trim())
            .filter((language) => language.length > 0),
        );
      const adopted = await writeApi({
        actorId: user.id,
        path: "/catalog/adopt",
        body: { kind: item.kind, externalId: item.externalId },
        schema: AdoptResultSchema,
      });
      await writeApi({
        actorId: user.id,
        path: "/requests",
        body: {
          mediaId: adopted.mediaId,
          subtitleLanguages,
          includeFutureEpisodes: future,
          includeSpecials: specials,
        },
        schema: CommandResultSchema,
      });
      return adopted;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["requests"] });
      void navigate(`/media/${encodeURIComponent(result.mediaId)}`);
    },
  });
  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        request.mutate();
      }}
    >
      <label htmlFor="subtitle-languages">Subtitle languages</label>
      <input
        id="subtitle-languages"
        value={languages}
        onChange={(event) => {
          setLanguages(event.target.value);
        }}
        placeholder="en, zh-CN"
      />
      <p className="helper">
        Comma-separated language codes. Use zh-CN for Simplified Chinese.
      </p>
      {item.kind === "series" && (
        <>
          <label className="check-label">
            <input
              type="checkbox"
              checked={future}
              onChange={(event) => {
                setFuture(event.target.checked);
              }}
            />
            Include future episodes
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={specials}
              onChange={(event) => {
                setSpecials(event.target.checked);
              }}
            />
            Include specials
          </label>
        </>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={request.isPending || user.restricted}
      >
        {request.isPending
          ? "Adding your request…"
          : `Request ${item.kind === "movie" ? "film" : "series"}`}
      </button>
      {request.error !== null && <ErrorNotice error={request.error} />}
    </form>
  );
}
