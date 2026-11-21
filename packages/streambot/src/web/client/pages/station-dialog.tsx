import { useEffect, useId, useRef, useState } from "react";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { stationTask } from "@shepherdjerred/streambot/web/client/room/player-task.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import "@shepherdjerred/streambot/web/client/styles/dialog.css";

type Kind = "radio" | "tv";
type Scope = "room" | "mine" | "server";
type Preset = "my-mix" | "continue-series" | "sitcoms" | "movies" | "youtube";

const SCOPES: readonly { value: Scope; label: string }[] = [
  { value: "room", label: "What this channel plays" },
  { value: "mine", label: "What I play" },
  { value: "server", label: "What this server plays" },
];

const PRESETS: readonly { value: Preset; label: string }[] = [
  { value: "my-mix", label: "My mix" },
  { value: "continue-series", label: "Continue a series" },
  { value: "sitcoms", label: "Sitcoms" },
  { value: "movies", label: "Movies" },
  { value: "youtube", label: "YouTube" },
];

/**
 * Starts Radio (endless music on Listen) or TV (endless shows on Watch). A native modal dialog:
 * the browser makes the page inert, traps focus, closes on Escape and returns focus to the button.
 */
export function StationDialog(props: { kind: Kind; onClose: () => void }) {
  const remote = useRemote();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [scope, setScope] = useState<Scope>("room");
  const [seed, setSeed] = useState("");
  const [preset, setPreset] = useState<Preset>("my-mix");
  const start = useControl();
  const radio = props.kind === "radio";
  const place = remote.target?.voiceChannelName;

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby={titleId}
      onClose={props.onClose}
    >
      <form
        className="dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (start.pending) return;
          const task = stationTask(
            remote,
            radio
              ? { mode: "radio", scope, seed }
              : { mode: "tv", scope, tvPreset: preset },
          );
          start.run(async (signal) => {
            const outcome = await task(signal);
            if (outcome.ok) dialog.current?.close();
            return outcome;
          });
        }}
      >
        <h2 id={titleId} className="dialog-title">
          {radio ? "Start Radio" : "Start TV"}
        </h2>
        <p className="muted">
          {radio
            ? "Keeps music playing on Listen"
            : "Keeps shows and movies playing on Watch"}
          {place === undefined ? "." : " in " + place + "."}
        </p>
        {radio ? (
          <label className="field">
            Start from
            <input
              value={seed}
              maxLength={200}
              placeholder="An artist, a song or a mood…"
              onChange={(event) => {
                setSeed(event.target.value);
              }}
            />
            <span className="field-hint">
              Leave empty to start from listening history.
            </span>
          </label>
        ) : (
          <label className="field">
            Play
            <select
              value={preset}
              onChange={(event) => {
                const next = PRESETS.find(
                  (item) => item.value === event.target.value,
                );
                if (next !== undefined) setPreset(next.value);
              }}
            >
              {PRESETS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="choices">
          <legend className="field">Pick from</legend>
          {SCOPES.map((item) => (
            <label key={item.value} className="choice">
              <input
                type="radio"
                name="scope"
                value={item.value}
                checked={scope === item.value}
                onChange={() => {
                  setScope(item.value);
                }}
              />
              {item.label}
            </label>
          ))}
        </fieldset>
        <ControlStatus surface="dialog" control={start} />
        <div className="dialog-actions btn-row">
          <button
            type="button"
            className="btn"
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={"btn " + (radio ? "btn-listen" : "btn-watch")}
            aria-busy={start.pending}
            aria-disabled={start.pending || remote.target === null}
          >
            {start.pending ? "Starting…" : radio ? "Start Radio" : "Start TV"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
