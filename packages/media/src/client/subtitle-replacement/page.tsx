import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import { SubtitleTargetListSchema } from "#shared/admin.ts";
import {
  PrepareSubtitleReplacementSchema,
  SubtitleReplacementListSchema,
} from "#shared/subtitle-replacement.ts";
import { readApi, writeApi } from "#client/api.ts";
import {
  PageTitle,
  Loading,
  ErrorNotice,
  humanize,
} from "#client/components.tsx";
import { SubtitleReplacementReview } from "./review.tsx";

export function SubtitleReplacementPage({ user }: { user: MediaUser }) {
  const { id } = useParams();
  return id === undefined ? (
    <ReplacementIndex user={user} />
  ) : (
    <SubtitleReplacementReview user={user} id={id} />
  );
}
function ReplacementIndex({ user }: { user: MediaUser }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["subtitle-replacements", cursor],
    queryFn: () =>
      readApi(
        `/admin/subtitle-replacements${cursor === null ? "" : `?cursor=${cursor}`}`,
        SubtitleReplacementListSchema,
      ),
    refetchInterval: 5000,
  });
  const targets = useQuery({
    queryKey: ["subtitle-targets", search],
    queryFn: () =>
      readApi(
        `/admin/subtitles/targets?q=${encodeURIComponent(search)}`,
        SubtitleTargetListSchema,
      ),
  });
  const prepare = useMutation({
    mutationFn: async (form: FormData) => {
      const subtitles =
        targets.data?.flatMap((target) => target.subtitles) ?? [];
      const old = subtitles.find((subtitle) => subtitle.id === form.get("old"));
      const candidate = subtitles.find(
        (subtitle) => subtitle.id === form.get("candidate"),
      );
      if (old === undefined || candidate === undefined)
        throw new Error(
          "Select the installed subtitle and validated candidate.",
        );
      return writeApi({
        actorId: user.id,
        path: "/admin/subtitle-replacements",
        schema: CommandResultSchema,
        body: PrepareSubtitleReplacementSchema.parse({
          oldSubtitleId: old.id,
          candidateSubtitleId: candidate.id,
          expectedOldVersion: old.version,
          expectedCandidateVersion: candidate.version,
        }),
      });
    },
    onSuccess: (result) => {
      if (result.subtitleReplacementId !== undefined)
        void navigate(
          `/admin/subtitle-replacements/${result.subtitleReplacementId}`,
        );
    },
  });
  return (
    <>
      <PageTitle eyebrow="Library care" title="Subtitle replacement">
        <p>
          Review an exact, validated replacement for an owned installed sidecar.
          Videos and embedded subtitles stay unchanged.
        </p>
      </PageTitle>
      <p>
        <Link to="/admin">
          Upload a replacement candidate in Administration
        </Link>
      </p>
      {list.error !== null && <ErrorNotice error={list.error} />}
      {targets.error !== null && <ErrorNotice error={targets.error} />}
      {prepare.error !== null && <ErrorNotice error={prepare.error} />}
      <section className="panel">
        <h2>Prepare a review</h2>
        <p>
          Choose two records for the same video, language, forced/HI variant and
          filename. Preparation checks files without replacing them.
        </p>
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            const query = new FormData(event.currentTarget).get("query");
            if (typeof query !== "string")
              throw new TypeError("Missing search query");
            setSearch(query);
          }}
        >
          <label>
            Find a video
            <input name="query" type="search" maxLength={200} />
          </label>
          <button className="button">Search library</button>
        </form>
        {targets.isPending && <Loading />}
        <form
          className="stack-form"
          onSubmit={(event) => {
            event.preventDefault();
            prepare.mutate(new FormData(event.currentTarget));
          }}
        >
          <label>
            Installed sidecar
            <select name="old" required defaultValue="">
              <option value="" disabled>
                Select the current subtitle
              </option>
              {targets.data?.flatMap((target) =>
                target.subtitles
                  .filter(
                    (subtitle) =>
                      subtitle.state === "installed" &&
                      subtitle.storageKind === "sidecar",
                  )
                  .map((subtitle) => (
                    <option key={subtitle.id} value={subtitle.id}>
                      {target.titles.join(" · ")} — {subtitle.filename} ·{" "}
                      {subtitle.qualityStatus}
                    </option>
                  )),
              )}
            </select>
          </label>
          <label>
            Validated replacement
            <select name="candidate" required defaultValue="">
              <option value="" disabled>
                Select validated bytes
              </option>
              {targets.data?.flatMap((target) =>
                target.subtitles
                  .filter(
                    (subtitle) =>
                      subtitle.state === "validated" &&
                      subtitle.qualityStatus === "accepted",
                  )
                  .map((subtitle) => (
                    <option key={subtitle.id} value={subtitle.id}>
                      {target.titles.join(" · ")} — {subtitle.language} ·{" "}
                      {subtitle.forced === true ? "forced" : "full"} ·{" "}
                      {subtitle.providerId} · {subtitle.id.slice(0, 8)}
                    </option>
                  )),
              )}
            </select>
          </label>
          <button className="button primary" disabled={prepare.isPending}>
            {prepare.isPending
              ? "Preparing…"
              : "Prepare exact replacement review"}
          </button>
        </form>
      </section>
      <section className="panel">
        <h2>Replacement operations</h2>
        {list.isPending && <Loading />}
        {list.data?.items.length === 0 && (
          <p>No replacements have been prepared.</p>
        )}
        <div className="item-list">
          {list.data?.items.map((item) => (
            <article key={item.id} className="list-item">
              <div>
                <h3>
                  <Link to={`/admin/subtitle-replacements/${item.id}`}>
                    {item.titles.map((title) => title.title).join(" · ")}
                  </Link>
                </h3>
                <p>
                  {item.destinationName} · {humanize(item.state)}
                </p>
                {item.reason !== null && <p>{humanize(item.reason)}</p>}
                {item.reservationActive && (
                  <p>Held until this review is applied or safely reconciled.</p>
                )}
              </div>
            </article>
          ))}
        </div>
        <div className="button-row">
          {cursor !== null && (
            <button
              className="button"
              onClick={() => {
                setCursor(null);
              }}
            >
              First page
            </button>
          )}
          {list.data?.nextCursor != null && (
            <button
              className="button"
              onClick={() => {
                setCursor(list.data?.nextCursor ?? null);
              }}
            >
              Next page
            </button>
          )}
        </div>
      </section>
    </>
  );
}
