import { useId, useState } from "react";
import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { Artwork } from "@shepherdjerred/streambot/web/client/media/artwork.tsx";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { PlayerControls, Timeline } from "./player-controls.tsx";
import { stationTask } from "./player-task.ts";
import { QueueList } from "./queue-list.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { SubtitlesDialog } from "./subtitles-dialog.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import "@shepherdjerred/streambot/web/client/styles/player.css";

const SCOPE_LABEL = {
  room: "this channel's picks",
  mine: "your picks",
  server: "this server's picks",
} as const;

const PRESET_LABEL = {
  "my-mix": "My mix",
  "continue-series": "Continue a series",
  sitcoms: "Sitcoms",
  movies: "Movies",
  youtube: "YouTube",
} as const;

/** The active Radio or TV station on a card, with its own Stop. */
function StationBadge(props: { player: WebRoomPlayer }) {
  const remote = useRemote();
  const control = useControl();
  const { station } = props.player;
  if (station === null) return null;
  const name = station.kind === "radio" ? "Radio" : "TV";
  const detail =
    station.seed ??
    (station.tvPreset === undefined
      ? undefined
      : PRESET_LABEL[station.tvPreset]) ??
    SCOPE_LABEL[station.scope];
  return (
    <div className="station">
      <span className="station-name">
        <span className="badge">{name}</span> {detail}
      </span>
      <button
        type="button"
        className="btn btn-small"
        aria-busy={control.pending}
        disabled={control.pending}
        onClick={() => {
          control.run(
            stationTask(remote, { mode: "off", slot: props.player.slot }),
          );
        }}
      >
        Stop {name}
      </button>
      <ControlStatus className="station-status" control={control} />
    </div>
  );
}

/**
 * One playback destination in the viewer's voice channel: what plays, its own controls, and its
 * own queue. The heading names the destination the way the play buttons do.
 */
export function PlayerCard(props: {
  player: WebRoomPlayer;
  streamNumber: number;
}) {
  const remote = useRemote();
  const { player } = props;
  const headingId = useId();
  const [subtitles, setSubtitles] = useState(false);
  const listen = player.transport === "listen";
  const place = remote.target?.voiceChannelName ?? "";
  const current = player.current;
  return (
    <article
      className={"player player-" + player.transport}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} className="player-heading">
        <span aria-hidden="true">{listen ? "♪" : "▶"}</span>
        {listen ? "Listening" : "Watching"}
        <span className="player-place">
          · {place}
          {props.streamNumber > 1
            ? ` · stream ${String(props.streamNumber)}`
            : ""}
        </span>
      </h2>
      <StationBadge player={player} />
      {current === null ? (
        <p className="player-idle">
          {player.station === null
            ? "Nothing playing."
            : "Choosing the next item…"}
        </p>
      ) : (
        <div className="now">
          <Artwork
            item={{
              kind: listen ? "song" : "video",
              ...(current.artworkUrl === undefined
                ? {}
                : { artworkUrl: current.artworkUrl }),
              ...(current.sportsArtwork === undefined
                ? {}
                : { sportsArtwork: current.sportsArtwork }),
            }}
            shape="thumb"
          />
          <div className="now-text">
            <span className="now-title">{current.title}</span>
            {current.requester !== undefined && (
              <span className="now-detail">
                Added by {current.requester.name}
              </span>
            )}
          </div>
        </div>
      )}
      {current !== null && <Timeline player={player} />}
      <PlayerControls
        player={player}
        onSubtitles={() => {
          setSubtitles(true);
        }}
      />
      <QueueList player={player} />
      {subtitles && (
        <SubtitlesDialog
          player={player}
          onClose={() => {
            setSubtitles(false);
          }}
        />
      )}
    </article>
  );
}
