import type { z } from "zod";
import type { MediaSelectionSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { Artwork } from "./artwork.tsx";
import { SportsArtwork } from "./sports-artwork.tsx";
import type { SportsArtwork as Matchup } from "@shepherdjerred/streambot/sports/artwork.ts";

export type Selection = z.infer<typeof MediaSelectionSchema>;
export type MediaListProps = {
  guildId: string;
  canPlay: boolean;
  busy: boolean;
  advanced: boolean;
  sportsEnabled: boolean;
  historyEnabled?: boolean | undefined;
  csrfToken?: string;
  snapshot?: WebSnapshot | null;
  actionLabel?: (
    selection: Selection,
    preferredChannel?: number,
  ) => "Play" | "Queue";
  play: (selection: Selection, placement: "queue" | "next" | "now") => void;
};

export function MediaRow(
  props: MediaListProps & {
    title: string;
    detail: string;
    selection: Selection;
    artworkUrl?: string;
    sportsArtwork?: Matchup;
    landscape?: boolean;
    available?: boolean;
    badge?: "Live" | "Upcoming";
    preferredChannel?: number;
    onSchedule?: () => void;
  },
) {
  return (
    <article
      className={
        "media-row" +
        (props.landscape === true ? " landscape-row" : "") +
        (props.onSchedule === undefined ? "" : " schedulable-event")
      }
    >
      {props.selection.kind === "sports" ||
      props.sportsArtwork !== undefined ? (
        <SportsArtwork
          {...(props.sportsArtwork === undefined
            ? {}
            : { artwork: props.sportsArtwork })}
        />
      ) : (
        <Artwork
          {...(props.artworkUrl === undefined ? {} : { url: props.artworkUrl })}
        />
      )}
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
    preferredChannel?: number;
    onSchedule?: () => void;
  },
) {
  const disabled = !props.canPlay || props.busy || props.available === false;
  const label =
    props.actionLabel?.(props.selection, props.preferredChannel) ?? "Play";
  return (
    <div className="row-actions">
      {props.onSchedule === undefined ? (
        <>
          <button
            title={
              props.available === false
                ? "This item is unavailable to play"
                : label === "Play"
                  ? "Start playback"
                  : "Add to queue"
            }
            aria-label={label + " " + props.title}
            disabled={disabled}
            onClick={() => {
              props.play(props.selection, "queue");
            }}
          >
            {label === "Play" ? "▶" : "+"}
            <span className="button-label"> {label}</span>
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
        </>
      ) : (
        <button
          disabled={!props.canPlay || props.busy}
          onClick={props.onSchedule}
        >
          Schedule playback
        </button>
      )}
    </div>
  );
}
