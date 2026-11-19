import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { useState } from "react";
import type { MediaUser } from "#shared/contract.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import {
  LibraryKeepingResultSchema,
  type LibraryKeepingCommand,
} from "#shared/household/interests.ts";
import { queryClient, readApi, writeApi } from "#client/api.ts";
import {
  EmptyState,
  ErrorNotice,
  Loading,
  MediaLink,
  PageTitle,
  Status,
} from "#client/components.tsx";
import "#client/calendar/style.css";
import { firstListCursor } from "#client/household/list-cursor.ts";

export function LibraryPage({ user }: { user: MediaUser }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const library = useInfiniteQuery({
    queryKey: ["library", query, kind],
    initialPageParam: firstListCursor(),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ query, kind });
      if (pageParam !== null) params.set("cursor", pageParam);
      return readApi(`/library?${params.toString()}`, LibraryPageSchema);
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = library.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <PageTitle
        eyebrow={
          user.role === "owner"
            ? "Your household collection"
            : "Your shared collection"
        }
        title="Library"
      >
        <p>
          Your favorites and temporary requests, with the reason each title
          stays.
        </p>
      </PageTitle>
      <section className="panel calendar-toolbar" aria-label="Library filters">
        <label>
          Search library{" "}
          <input
            type="search"
            maxLength={200}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </label>
        <label>
          Titles{" "}
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value);
            }}
          >
            <option value="all">Movies and TV</option>
            <option value="movie">Movies</option>
            <option value="series">TV shows</option>
          </select>
        </label>
      </section>
      {library.isPending && <Loading />}
      {library.error !== null && <ErrorNotice error={library.error} />}
      {!library.isPending && items.length === 0 && (
        <EmptyState title="No matching titles">
          Try another search or add a request.
        </EmptyState>
      )}
      <div className="item-list">
        {items.map((item) => (
          <article key={item.id} className="request-row">
            <div className="item-main">
              <MediaLink id={item.id} title={item.title} />
              <p>
                {item.kind === "movie" ? "Movie" : "TV show"}
                {item.year === null ? "" : ` · ${String(item.year)}`}
              </p>
              <p>
                {item.policy === "keep"
                  ? "Keep indefinitely"
                  : item.policy === "temporary"
                    ? "Temporary"
                    : "Policy needs review"}
                {item.myInterest === "following"
                  ? " · You are following"
                  : item.myInterest === "released"
                    ? " · Your interest has ended"
                    : ""}
              </p>
              <p className="muted">
                {item.protection === "keep_indefinitely"
                  ? "Protected by permanent Keep."
                  : item.protection === "temporary_interest"
                    ? "Protected while someone is following."
                    : "Protected until its management policy is reconciled."}
              </p>
              <p className="helper">
                Open the title for{" "}
                {item.kind === "series" ? "episode coverage, " : ""}quality and
                subtitle status.
              </p>
            </div>
            {item.availability !== null && <Status value={item.availability} />}
            {item.libraryKeeping !== null && (
              <LibraryKeepingControl user={user} item={item} />
            )}
          </article>
        ))}
      </div>
      {library.hasNextPage && (
        <button
          className="button"
          disabled={library.isFetchingNextPage}
          onClick={() => {
            void library.fetchNextPage();
          }}
        >
          Load more titles
        </button>
      )}
    </>
  );
}

function LibraryKeepingControl({
  user,
  item,
}: {
  user: MediaUser;
  item: z.infer<typeof LibraryPageSchema>["items"][number];
}) {
  const current = item.libraryKeeping;
  const change = useMutation({
    mutationFn: async () => {
      if (current === null) throw new Error("Library policy is unavailable");
      return writeApi({
        actorId: user.id,
        path: `/library/${encodeURIComponent(item.id)}/keeping-policy`,
        body: {
          schemaVersion: 1,
          mediaId: item.id,
          edition: "default",
          expectedMediaVersion: current.mediaVersion,
          expectedTargetVersion: current.targetVersion,
          keepingPolicy:
            current.keepingPolicy === "keep" ? "temporary" : "keep",
        } satisfies LibraryKeepingCommand,
        schema: LibraryKeepingResultSchema,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["library"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar"] }),
        queryClient.invalidateQueries({ queryKey: ["removals"] }),
      ]);
    },
  });
  if (current === null) return null;
  return (
    <div>
      <button
        className="button subtle"
        disabled={change.isPending}
        onClick={() => {
          change.mutate();
        }}
      >
        {current.keepingPolicy === "keep"
          ? "Make library temporary"
          : "Keep library indefinitely"}
      </button>
      <p className="helper">
        Requesters’ own interests continue to protect this title.
      </p>
      {change.error !== null && <ErrorNotice error={change.error} />}
    </div>
  );
}
