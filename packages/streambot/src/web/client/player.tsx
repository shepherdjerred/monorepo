import { useEffect, useState } from "react";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { elapsed, type RemoteAction } from "./api.ts";
import { Artwork } from "./artwork.tsx";

type PlayerProps = {
  snapshot: WebSnapshot;
  busy: boolean;
  send: (action: RemoteAction) => void;
  subtitles: () => void;
};

export function Player({ snapshot, busy, send, subtitles }: PlayerProps) {
  return (
    <section className="player panel" aria-label="Playback controls">
      <PlayerTitle snapshot={snapshot} />
      <Transport snapshot={snapshot} busy={busy} send={send} />
      <Timeline snapshot={snapshot} busy={busy} send={send} />
      <PlayerOptions
        snapshot={snapshot}
        busy={busy}
        send={send}
        subtitles={subtitles}
      />
    </section>
  );
}

function PlayerTitle({ snapshot }: Pick<PlayerProps, "snapshot">) {
  const current = snapshot.current;
  return (
    <div className="player-title">
      <Artwork
        className="player-artwork"
        {...(current?.artworkUrl === undefined
          ? {}
          : { url: current.artworkUrl })}
      />
      <div>
        <p className="eyebrow">
          {snapshot.paused
            ? "PAUSED"
            : current === null
              ? "READY WHEN YOU ARE"
              : "NOW PLAYING"}
        </p>
        <h2>{current?.title ?? "Your next favorite is waiting"}</h2>
        <p className="muted">
          {current === null
            ? "Queue a title to get started."
            : "Playing in " + (snapshot.channel?.name ?? "Discord")}
        </p>
      </div>
    </div>
  );
}

function Transport({ snapshot, busy, send }: Omit<PlayerProps, "subtitles">) {
  const unavailable =
    busy || snapshot.current === null || snapshot.channel === null;
  return (
    <div className="transport">
      <button
        className="play-button"
        aria-label={snapshot.paused ? "Resume playback" : "Pause playback"}
        disabled={
          unavailable ||
          !snapshot.advancedControls ||
          snapshot.restrictedLive ||
          snapshot.state === "resolving"
        }
        onClick={() => {
          send({ action: snapshot.paused ? "resume" : "pause" });
        }}
      >
        {snapshot.paused ? "▶" : "Ⅱ"}
      </button>
      <button
        aria-label="Skip current media"
        disabled={unavailable}
        onClick={() => {
          send({ action: "skip" });
        }}
      >
        Skip ↦
      </button>
      <button
        aria-label="Stop playback and clear queue"
        disabled={unavailable}
        onClick={() => {
          if (globalThis.confirm("Stop playback and clear the queue?"))
            send({ action: "stop" });
        }}
      >
        Stop
      </button>
    </div>
  );
}

function Timeline({ snapshot, busy, send }: Omit<PlayerProps, "subtitles">) {
  const duration = snapshot.current?.durationSeconds ?? null;
  const [position, setPosition] = useState(snapshot.positionSeconds ?? 0);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setPosition(snapshot.positionSeconds ?? 0);
  }, [snapshot.positionSeconds, dragging]);
  const unavailable =
    busy || snapshot.current === null || snapshot.channel === null;
  function commitPosition() {
    setDragging(false);
    if (position !== snapshot.positionSeconds)
      send({ action: "seek", seconds: position });
  }
  return (
    <div className="timeline">
      <span>{elapsed(position)}</span>
      <input
        type="range"
        aria-label="Seek position"
        min={0}
        max={duration ?? 1}
        value={Math.min(position, duration ?? 1)}
        disabled={
          unavailable ||
          duration === null ||
          snapshot.restrictedLive ||
          snapshot.state === "resolving"
        }
        onChange={(event) => {
          setPosition(Number(event.target.value));
        }}
        onPointerDown={() => {
          setDragging(true);
        }}
        onPointerUp={commitPosition}
        onPointerCancel={() => {
          setDragging(false);
        }}
        onKeyDown={() => {
          setDragging(true);
        }}
        onKeyUp={commitPosition}
      />
      <span>
        {duration === null && snapshot.current !== null
          ? "LIVE / UNKNOWN"
          : elapsed(duration)}
      </span>
    </div>
  );
}

function PlayerOptions({ snapshot, busy, send, subtitles }: PlayerProps) {
  const [volume, setVolume] = useState(snapshot.volume);
  useEffect(() => {
    setVolume(snapshot.volume);
  }, [snapshot.volume]);
  const unavailable =
    busy || snapshot.current === null || snapshot.channel === null;
  return (
    <div className="player-options">
      <label className="volume">
        Volume{" "}
        <input
          type="range"
          min={0}
          max={200}
          value={volume}
          disabled={
            busy || snapshot.channel === null || snapshot.revision === null
          }
          onChange={(event) => {
            setVolume(Number(event.target.value));
          }}
          onPointerUp={() => {
            if (volume !== snapshot.volume)
              send({ action: "volume", percent: volume });
          }}
          onKeyUp={() => {
            if (volume !== snapshot.volume)
              send({ action: "volume", percent: volume });
          }}
        />
        <span>{volume}%</span>
      </label>
      <label className="repeat">
        Repeat
        <select
          aria-label="Repeat mode"
          value={snapshot.loop}
          disabled={
            busy || snapshot.revision === null || snapshot.restrictedLive
          }
          onChange={(event) => {
            const mode = event.target.value;
            if (mode === "off" || mode === "track" || mode === "queue")
              send({ action: "loop", mode });
          }}
        >
          <option value="off">Off</option>
          <option value="track">One</option>
          <option value="queue">All</option>
        </select>
      </label>
      <button
        disabled={
          unavailable ||
          snapshot.current?.mediaKind !== "video" ||
          snapshot.paused ||
          snapshot.restrictedLive ||
          snapshot.state === "resolving"
        }
        onClick={subtitles}
      >
        Subtitles
      </button>
    </div>
  );
}

export function Queue({ snapshot, busy, send }: PlayerProps) {
  return (
    <aside className="queue panel">
      <div className="queue-heading">
        <div>
          <p className="eyebrow">UP NEXT</p>
          <h2>
            The queue <span className="count">{snapshot.queue.length}</span>
          </h2>
        </div>
        <span aria-hidden="true">≋</span>
      </div>
      <div className="queue-tools">
        <button
          disabled={
            busy || snapshot.queue.length < 2 || snapshot.restrictedLive
          }
          onClick={() => {
            send({ action: "shuffle" });
          }}
        >
          ⇄ Shuffle
        </button>
        <button
          disabled={
            busy || snapshot.queue.length === 0 || snapshot.restrictedLive
          }
          onClick={() => {
            if (globalThis.confirm("Clear all queued media?"))
              send({ action: "clear" });
          }}
        >
          Clear
        </button>
      </div>
      {snapshot.queue.length === 0 ? (
        <div className="empty queue-empty">
          <span aria-hidden="true">≋</span>
          <h3>Room for something good</h3>
          <p>
            Titles you queue will appear here.
            <br />
            Everyone in your channel can join in.
          </p>
        </div>
      ) : (
        <ol className="queue-list">
          {snapshot.queue.map((item, index) => (
            <li key={String(index) + item.title}>
              <span className="queue-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.artworkUrl !== undefined && (
                <Artwork className="queue-artwork" url={item.artworkUrl} />
              )}
              <div>
                <h3>{item.title}</h3>
                <div className="queue-item-actions">
                  <button
                    aria-label={"Move " + item.title + " up"}
                    disabled={busy || index === 0 || snapshot.restrictedLive}
                    onClick={() => {
                      send({ action: "move", from: index + 1, to: index });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    aria-label={"Move " + item.title + " down"}
                    disabled={
                      busy ||
                      index === snapshot.queue.length - 1 ||
                      snapshot.restrictedLive
                    }
                    onClick={() => {
                      send({ action: "move", from: index + 1, to: index + 2 });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    aria-label={"Remove " + item.title}
                    disabled={busy || snapshot.restrictedLive}
                    onClick={() => {
                      send({ action: "remove", position: index + 1 });
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="queue-footnote">A good queue is a group effort.</p>
    </aside>
  );
}
