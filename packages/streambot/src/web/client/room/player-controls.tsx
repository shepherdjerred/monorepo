import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { playerTask } from "./player-task.ts";
import { formatTime, playbackPosition } from "./position.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import {
  useControl,
  useControlGroup,
} from "@shepherdjerred/streambot/web/client/use-control.ts";

/** How long a slider rests before its value is sent, so a drag is one command. */
const SETTLE_MS = 350;

/** The current time, ticking each second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

/**
 * A range input whose value is sent once the viewer stops moving it. The draft stays on screen
 * until the room reports a new sample (`sample` changes), so the thumb does not jump back first.
 */
function useSettledValue(sample: number, onSettle: (value: number) => void) {
  const [draft, setDraft] = useState<{ value: number; sent: boolean } | null>(
    null,
  );
  const settle = useRef(onSettle);
  settle.current = onSettle;
  useEffect(() => {
    if (draft === null || draft.sent) return;
    const timer = setTimeout(() => {
      settle.current(draft.value);
      setDraft({ value: draft.value, sent: true });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [draft]);
  useEffect(() => {
    setDraft((current) => (current?.sent === true ? null : current));
  }, [sample]);
  return [
    draft?.value ?? null,
    (value: number) => {
      setDraft({ value, sent: false });
    },
  ] as const;
}

/** Position and seek. Live sports and unknown durations show time but cannot seek. */
export function Timeline(props: { player: WebRoomPlayer }) {
  const remote = useRemote();
  const { player } = props;
  const control = useControl();
  const streaming = player.state === "streaming" && !player.paused;
  const now = useNow(streaming);
  const clock = remote.view?.clock ?? { serverTime: now, receivedAt: now };
  const position = playbackPosition(player, clock, now);
  const duration = player.current?.durationSeconds ?? null;
  const [draft, setDraft] = useSettledValue(player.positionAt, (seconds) => {
    control.run(playerTask(remote, player.slot, { action: "seek", seconds }));
  });
  const shown = draft ?? position;
  const seekable = duration !== null && !player.restrictedLive;
  return (
    <div className="timeline">
      <span className="numeric">{formatTime(shown)}</span>
      {seekable ? (
        <input
          type="range"
          className="slider"
          aria-label="Seek"
          aria-valuetext={formatTime(shown) + " of " + formatTime(duration)}
          min={0}
          max={Math.max(1, Math.round(duration))}
          step={1}
          value={Math.round(shown ?? 0)}
          onChange={(event) => {
            setDraft(Number(event.target.value));
          }}
        />
      ) : (
        <span className="timeline-live">
          {player.restrictedLive ? "Live" : ""}
        </span>
      )}
      <span className="numeric">{formatTime(duration)}</span>
      <ControlStatus className="timeline-status" control={control} />
    </div>
  );
}

/** Pause or resume (when the server allows it), skip and stop. */
export function Transport(props: { player: WebRoomPlayer }) {
  const remote = useRemote();
  const { player } = props;
  const group = useControlGroup({
    pause: useControl(),
    skip: useControl(),
    stop: useControl(),
  });
  const canPause = remote.room?.capabilities.pause === true;
  const button = (
    key: "pause" | "skip" | "stop",
    label: string,
    glyph: string,
    action: Parameters<typeof playerTask>[2],
  ) => (
    <button
      type="button"
      className="btn btn-icon"
      aria-label={label}
      title={label}
      aria-busy={group.controls[key].pending}
      disabled={group.controls[key].pending || player.current === null}
      onClick={() => {
        group.start(key, playerTask(remote, player.slot, action));
      }}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
  return (
    <div className="transport">
      <div className="btn-row">
        {canPause &&
          (player.paused
            ? button("pause", "Resume", "▶", { action: "resume" })
            : button("pause", "Pause", "❚❚", { action: "pause" }))}
        {button("skip", "Skip to the next item", "⏭", { action: "skip" })}
        {button("stop", "Stop and clear this player", "■", { action: "stop" })}
      </div>
      <ControlStatus control={group.status} />
    </div>
  );
}

const LOOP_NEXT = { off: "track", track: "queue", queue: "off" } as const;
const LOOP_LABEL = {
  off: "Repeat off",
  track: "Repeat this",
  queue: "Repeat queue",
};

function loopMode(value: string): keyof typeof LOOP_NEXT {
  return value === "track" || value === "queue" ? value : "off";
}

/** Transport (passed in) beside repeat and subtitles, then volume. */
export function PlayerOptions(props: {
  player: WebRoomPlayer;
  onSubtitles: () => void;
  children: ReactNode;
}) {
  const remote = useRemote();
  const { player } = props;
  const group = useControlGroup({ volume: useControl(), loop: useControl() });
  const [draft, setDraft] = useSettledValue(player.positionAt, (percent) => {
    group.start(
      "volume",
      playerTask(remote, player.slot, { action: "volume", percent }),
    );
  });
  const volume = draft ?? player.volume;
  const loop = loopMode(player.loop);
  const video = player.current?.mediaKind === "video";
  return (
    <div className="options">
      <div className="options-row">
        {props.children}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-small"
            aria-pressed={loop !== "off"}
            aria-busy={group.controls.loop.pending}
            disabled={group.controls.loop.pending}
            onClick={() => {
              group.start(
                "loop",
                playerTask(remote, player.slot, {
                  action: "loop",
                  mode: LOOP_NEXT[loop],
                }),
              );
            }}
          >
            {LOOP_LABEL[loop]}
          </button>
          {player.transport === "watch" && video && (
            <button
              type="button"
              className="btn btn-small"
              onClick={props.onSubtitles}
            >
              Subtitles
            </button>
          )}
        </div>
      </div>
      <label className="volume">
        <span className="visually-hidden">Volume</span>
        <span aria-hidden="true" className="muted">
          Vol
        </span>
        <input
          type="range"
          className="slider"
          min={0}
          max={200}
          step={5}
          value={volume}
          aria-valuetext={String(volume) + "%"}
          onChange={(event) => {
            setDraft(Number(event.target.value));
          }}
        />
        <span className="numeric volume-value" aria-hidden="true">
          {volume}%
        </span>
      </label>
      <ControlStatus className="options-status" control={group.status} />
    </div>
  );
}
