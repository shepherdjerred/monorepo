import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { CatalogDetailSchema } from "#shared/api.ts";
import type { CatalogDetail } from "#shared/api.ts";
import { LanguageSchema } from "#shared/contract.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { readTarget, writeTarget } from "./target-controls/api.ts";
import type { TargetSubmission } from "./target-controls/mutation.ts";
import { CommandError, commandNeedsReview } from "./target-controls/errors.tsx";
import type { MediaUser } from "#shared/contract.ts";
import { MovieRequestForm } from "./movie-editions/request.tsx";
import { SeriesRequestOptions } from "#client/series/request-options.tsx";
import { ApiError, queryClient, readApi, writeApi } from "./api.ts";
import { EmptyState, ErrorNotice, Loading, PageTitle } from "./components.tsx";

const AdoptResultSchema = z.object({ mediaId: z.string() });

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
      <Link className="back-link" to="/discover">
        ← Discover
      </Link>
      <PageTitle title={item.title}>
        <p>
          {item.kind === "movie" ? "Film" : "Series"}, {item.date.slice(0, 4)}
        </p>
        <p>{item.overview}</p>
      </PageTitle>
      <div className="detail-columns">
        <section className="panel">
          <h2>Make it part of your library</h2>
          <p className="muted">
            We’ll notify you when it’s ready to watch in Plex.
          </p>
          {item.kind === "movie" ? (
            <MovieRequestForm
              key={item.externalId}
              user={user}
              target={{ externalId: item.externalId }}
            />
          ) : (
            <RequestForm
              key={`${item.kind}:${String(item.externalId)}`}
              user={user}
              item={item}
            />
          )}
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
              <span className="status">
                {String(season.episodeCount)} episodes
              </span>
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
  const [context, setContext] = useState<DefaultTargetView | null>(null);
  const unacknowledged = useRef<TargetSubmission | null>(null);
  const request = useMutation({
    mutationFn: async () => {
      if (unacknowledged.current !== null) {
        const pending = unacknowledged.current;
        await writeTarget(user.id, pending.context, pending.command);
        return { mediaId: pending.context.scope.mediaId };
      }
      const subtitleLanguages = z
        .array(LanguageSchema)
        .max(20)
        .parse(
          languages
            .split(",")
            .map((language) => language.trim())
            .filter((language) => language.length > 0),
        );
      let observed = context;
      if (observed === null) {
        const adopted = await writeApi({
          actorId: user.id,
          path: "/catalog/adopt",
          body: { kind: item.kind, externalId: item.externalId },
          schema: AdoptResultSchema,
        });
        observed = await readTarget(adopted.mediaId);
        setContext(observed);
      }
      const command = {
        action: "request",
        subtitleLanguages,
        includeFutureEpisodes: future,
        includeSpecials: specials,
      } as const;
      unacknowledged.current = { context: observed, command };
      await writeTarget(user.id, observed, command);
      return { mediaId: observed.scope.mediaId };
    },
    onSuccess: async (result) => {
      unacknowledged.current = null;
      await queryClient.invalidateQueries({ queryKey: ["requests"] });
      void navigate(`/media/${encodeURIComponent(result.mediaId)}`);
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      )
        unacknowledged.current = null;
    },
  });
  const review = useMutation({
    mutationFn: async () => {
      if (context === null)
        throw new Error("Request details have not loaded yet.");
      return readTarget(context.scope.mediaId);
    },
    onSuccess: (current) => {
      setContext(current);
      request.reset();
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
        <SeriesRequestOptions
          future={future}
          specials={specials}
          onFutureChange={setFuture}
          onSpecialsChange={setSpecials}
        />
      )}
      <button
        className="button primary"
        type="submit"
        disabled={
          request.isPending ||
          review.isPending ||
          user.restricted ||
          commandNeedsReview(request.error)
        }
      >
        {request.isPending
          ? "Adding your request…"
          : `Request ${item.kind === "movie" ? "film" : "series"}`}
      </button>
      <CommandError
        error={request.error}
        review={() => {
          review.mutate();
        }}
      />
      {review.error !== null && <ErrorNotice error={review.error} />}
    </form>
  );
}
