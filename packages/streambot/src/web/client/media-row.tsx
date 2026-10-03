import type { z } from "zod";
import type { MediaSelectionSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { Artwork } from "./artwork.tsx";

export type Selection = z.infer<typeof MediaSelectionSchema>;
export type MediaListProps = {
  guildId: string;
  canPlay: boolean;
  busy: boolean;
  advanced: boolean;
  sportsEnabled: boolean;
  play: (selection: Selection, placement: "queue" | "next" | "now") => void;
};

export function MediaRow(
  props: MediaListProps & {
    title: string;
    detail: string;
    selection: Selection;
    artworkUrl?: string;
    available?: boolean;
    badge?: "Live" | "Upcoming";
  },
) {
  return (
    <article className="media-row">
      <Artwork
        {...(props.artworkUrl === undefined ? {} : { url: props.artworkUrl })}
      />
      <div className="media-info">
        {props.badge !== undefined && (
          <span
            className={
              props.badge === "Live" ? "event-badge live" : "event-badge"
            }
          >
            {props.badge}
          </span>
        )}
        <h3>{props.title}</h3>
        <p>{props.detail}</p>
      </div>
      <MediaActions {...props} />
    </article>
  );
}

export function MediaActions(
  props: MediaListProps & {
    title: string;
    selection: Selection;
    available?: boolean;
  },
) {
  const disabled = !props.canPlay || props.busy || props.available === false;
  return (
    <div className="row-actions">
      <button
        title={
          props.available === false
            ? "This event is not live yet"
            : "Add to queue"
        }
        aria-label={"Queue " + props.title}
        disabled={disabled}
        onClick={() => {
          props.play(props.selection, "queue");
        }}
      >
        +<span className="button-label"> Queue</span>
      </button>
      <details className="play-options">
        <summary aria-label={"More playback options for " + props.title}>
          ···
        </summary>
        <div>
          <button
            disabled={disabled}
            onClick={() => {
              props.play(props.selection, "next");
            }}
          >
            Play next
          </button>
          {props.advanced && (
            <button
              disabled={disabled}
              onClick={() => {
                props.play(props.selection, "now");
              }}
            >
              Play now
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
