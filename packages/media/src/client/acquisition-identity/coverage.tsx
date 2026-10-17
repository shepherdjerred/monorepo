import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MediaDetailSchema } from "#shared/api.ts";
import type { MediaDetail } from "#shared/api.ts";
import { readApi } from "#client/api.ts";
import { ErrorNotice, Loading } from "#client/components.tsx";

async function canonicalContext(mediaId: string) {
  const current = await readApi(`/media/${mediaId}`, MediaDetailSchema);
  if (current.kind === "movie" || current.kind === "series")
    return { current, root: current, initial: current };
  if (current.parentId === null)
    throw new Error("Canonical parent is missing.");
  const parent = await readApi(`/media/${current.parentId}`, MediaDetailSchema);
  if (parent.kind === "series")
    return { current, root: parent, initial: parent };
  if (parent.parentId === null) throw new Error("Canonical series is missing.");
  const root = await readApi(`/media/${parent.parentId}`, MediaDetailSchema);
  return { current, root, initial: parent };
}

export function CoveragePicker({
  mediaId,
  selected,
  onChange,
}: {
  mediaId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const context = useQuery({
    queryKey: ["identity-canonical", mediaId],
    queryFn: () => canonicalContext(mediaId),
  });
  if (context.isPending) return <Loading />;
  if (context.error !== null) return <ErrorNotice error={context.error} />;
  if (context.data.current.kind === "movie")
    return (
      <p>
        Movie: <strong>{context.data.current.title}</strong> (
        {context.data.current.year})
      </p>
    );
  return (
    <EpisodeChoices
      key={context.data.root.id}
      context={context.data}
      selected={selected}
      onChange={onChange}
    />
  );
}

function EpisodeChoices({
  context,
  selected,
  onChange,
}: {
  context: { current: MediaDetail; root: MediaDetail; initial: MediaDetail };
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [containerId, setContainerId] = useState(context.initial.id);
  const container = useQuery({
    queryKey: ["identity-episode-choices", containerId],
    queryFn: () => readApi(`/media/${containerId}`, MediaDetailSchema),
    initialData:
      containerId === context.initial.id ? context.initial : undefined,
  });
  const episodes =
    container.data?.children.filter((item) => item.kind === "episode") ?? [];
  return (
    <fieldset className="stack-form">
      <legend>
        Exact episodes in {context.root.title} ({context.root.year})
      </legend>
      <p>
        Select every episode in this release. Files outside this coverage will
        be blocked. Up to 100 episodes can be reviewed together.
      </p>
      {context.root.children.some((item) => item.kind === "season") && (
        <label>
          Season
          <select
            value={containerId}
            onChange={(event) => {
              setContainerId(event.target.value);
            }}
          >
            <option value={context.root.id}>
              Series episodes and specials
            </option>
            {context.root.children
              .filter((item) => item.kind === "season")
              .map((season) => (
                <option key={season.id} value={season.id}>
                  {season.title}
                </option>
              ))}
          </select>
        </label>
      )}
      {container.isPending && <Loading />}
      {container.error !== null && <ErrorNotice error={container.error} />}
      <div className="actions">
        <button
          className="button"
          type="button"
          disabled={
            episodes.length === 0 ||
            new Set([...selected, ...episodes.map((episode) => episode.id)])
              .size > 100
          }
          onClick={() => {
            onChange([
              ...new Set([
                ...selected,
                ...episodes.map((episode) => episode.id),
              ]),
            ]);
          }}
        >
          Include this season
        </button>
        <span>{selected.length} selected</span>
      </div>
      {episodes.map((episode) => (
        <label className="checkbox-label" key={episode.id}>
          <input
            type="checkbox"
            checked={selected.includes(episode.id)}
            disabled={
              episode.id === context.current.id ||
              (!selected.includes(episode.id) && selected.length >= 100)
            }
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...selected, episode.id]
                  : selected.filter((id) => id !== episode.id),
              );
            }}
          />
          S{episode.seasonNumber} E{episode.episodeNumber}: {episode.title}
        </label>
      ))}
    </fieldset>
  );
}
