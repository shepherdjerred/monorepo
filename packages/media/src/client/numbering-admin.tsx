import { useState, type SyntheticEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MediaUser } from "#shared/contract.ts";
import { CommandResultSchema } from "#shared/api.ts";
import {
  NumberingEpisodeListSchema,
  NumberingSeriesListSchema,
  SaveEpisodeNumberingSchema,
  type SaveEpisodeNumbering,
} from "#shared/numbering.ts";
import { queryClient, readApi, writeApi } from "./api.ts";
import { ErrorNotice, Loading, Notice } from "./components.tsx";

function EpisodeEditor({
  user,
  episode,
}: {
  user: MediaUser;
  episode: {
    id: string;
    title: string;
    seasonNumber: number;
    episodeNumber: number;
    version: number;
    absoluteNumber: number | null;
    evidence: string | null;
  };
}) {
  const [error, setError] = useState<Error | null>(null);
  const save = useMutation({
    mutationFn: async (input: SaveEpisodeNumbering) =>
      writeApi({
        actorId: user.id,
        path: `/admin/numbering/episodes/${episode.id}`,
        method: "PUT",
        body: input,
        schema: CommandResultSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["numbering-episodes"] });
    },
  });
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      save.mutate(
        SaveEpisodeNumberingSchema.parse({
          expectedVersion: episode.version,
          absoluteNumber:
            form.get("absolute") === "" ? null : Number(form.get("absolute")),
          evidence: form.get("evidence"),
        }),
      );
    } catch {
      setError(
        new Error(
          "Enter a positive episode number and supporting evidence, or clear the number to remove the mapping.",
        ),
      );
    }
  }
  return (
    <form className="panel stack-form" onSubmit={submit}>
      <h3>
        S{episode.seasonNumber} E{episode.episodeNumber}: {episode.title}
      </h3>
      <label>
        Absolute release number
        <input
          name="absolute"
          type="number"
          min="1"
          step="1"
          defaultValue={episode.absoluteNumber ?? ""}
        />
      </label>
      <label>
        Source and mapping evidence
        <textarea
          name="evidence"
          required
          minLength={10}
          maxLength={2000}
          rows={2}
          defaultValue={episode.evidence ?? ""}
        />
      </label>
      {error !== null && <ErrorNotice error={error} />}
      {save.error !== null && <ErrorNotice error={save.error} />}
      {save.isSuccess && <Notice>Mapping saved.</Notice>}
      <button className="button" disabled={save.isPending}>
        Save numbering
      </button>
    </form>
  );
}
export function NumberingAdministration({ user }: { user: MediaUser }) {
  const [query, setQuery] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [offset, setOffset] = useState(0);
  const series = useQuery({
    queryKey: ["numbering-series", query],
    queryFn: async () =>
      readApi(
        `/admin/numbering/series?q=${encodeURIComponent(query)}`,
        NumberingSeriesListSchema,
      ),
  });
  const episodes = useQuery({
    queryKey: ["numbering-episodes", seriesId, offset],
    queryFn: async () =>
      readApi(
        `/admin/numbering/series/${seriesId}?offset=${String(offset)}`,
        NumberingEpisodeListSchema,
      ),
    enabled: seriesId !== "",
  });
  return (
    <section className="stack-form" aria-labelledby="numbering-heading">
      <h2 id="numbering-heading">Anime absolute numbering</h2>
      <p>
        Map release numbers to canonical episodes. These overrides support
        absolute-numbered releases; they do not change Plex season or episode
        names.
      </p>
      <label>
        Find a series
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>
      <label>
        Canonical series
        <select
          value={seriesId}
          onChange={(event) => {
            setSeriesId(event.target.value);
            setOffset(0);
          }}
        >
          <option value="">Select a series</option>
          {series.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title} {item.year}
            </option>
          ))}
        </select>
      </label>
      {series.error !== null && <ErrorNotice error={series.error} />}
      {episodes.error !== null && <ErrorNotice error={episodes.error} />}
      {seriesId !== "" && episodes.isPending && <Loading />}
      <div className="item-list">
        {episodes.data?.map((episode) => (
          <EpisodeEditor
            key={`${episode.id}:${String(episode.version)}`}
            user={user}
            episode={episode}
          />
        ))}
      </div>
      {seriesId !== "" && (
        <div className="actions">
          <button
            className="button"
            disabled={offset === 0}
            onClick={() => {
              setOffset(Math.max(0, offset - 200));
            }}
          >
            Previous episodes
          </button>
          <button
            className="button"
            disabled={episodes.data?.length !== 200}
            onClick={() => {
              setOffset(offset + 200);
            }}
          >
            Next episodes
          </button>
        </div>
      )}
    </section>
  );
}
