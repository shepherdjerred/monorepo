import { useEffect, useRef, useState } from "react";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { RemoteAction } from "@shepherdjerred/streambot/web/client/api.ts";
import { scopeDisplayLabel, type WebStationScope } from "./station-label.ts";

const SCOPE_OPTIONS: readonly {
  readonly value: WebStationScope;
  readonly label: string;
  readonly description: string;
}[] = [
  { value: "room", label: "Room", description: "Blend everyone listening" },
  { value: "mine", label: "Mine", description: "Your favorites & history" },
  { value: "server", label: "Server", description: "Whole server favorites" },
];

export type RadioBannerProps = {
  readonly snapshot: WebSnapshot | null | undefined;
  readonly canPlay: boolean;
  readonly busy: boolean;
  readonly send?: ((action: RemoteAction) => void) | undefined;
};

export function RadioBanner({
  snapshot,
  canPlay,
  busy,
  send,
}: RadioBannerProps) {
  const activeRadio =
    snapshot?.station?.kind === "radio" ? snapshot.station : null;
  const [scope, setScope] = useState<WebStationScope>(
    activeRadio?.scope ?? "room",
  );
  const [seed, setSeed] = useState<string>(activeRadio?.seed ?? "");
  const [formError, setFormError] = useState<string>("");
  const seedInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeRadio !== null) {
      setScope(activeRadio.scope);
      setSeed(activeRadio.seed ?? "");
    }
  }, [activeRadio?.scope, activeRadio?.seed]);

  if (snapshot?.radioEnabled !== true) {
    return null;
  }

  return (
    <div className="radio-banner">
      <div className="radio-banner-header">
        <div>
          <p className="eyebrow">CONTINUOUS STATION</p>
          <h2 id="radio-banner-heading">Radio</h2>
        </div>
        {activeRadio !== null && (
          <div className="radio-active-status">
            <span className="station-badge">
              {activeRadio.seed === undefined
                ? `RADIO · ${scopeDisplayLabel(activeRadio.scope)}`
                : `RADIO · ${activeRadio.seed} (${scopeDisplayLabel(activeRadio.scope)})`}
            </span>
            <button
              type="button"
              className="station-stop"
              disabled={busy}
              onClick={() => {
                send?.({ action: "station", mode: "off" });
              }}
            >
              Stop Radio
            </button>
          </div>
        )}
      </div>
      <form
        className="radio-form"
        aria-labelledby="radio-banner-heading"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canPlay) {
            setFormError("Join a Discord voice channel first to start Radio.");
            seedInputRef.current?.focus();
            return;
          }
          setFormError("");
          const trimmedSeed = seed.trim();
          send?.({
            action: "station",
            mode: "radio",
            scope,
            ...(trimmedSeed === "" ? {} : { seed: trimmedSeed }),
          });
        }}
      >
        <div className="radio-seed-group">
          <label htmlFor="radio-seed-input">
            Mood, artist, or genre (optional)
          </label>
          <p id="radio-seed-hint" className="radio-hint">
            Leave blank to blend listener favorites and related discoveries.
          </p>
          <input
            ref={seedInputRef}
            id="radio-seed-input"
            name="seed"
            type="text"
            maxLength={200}
            placeholder="Chill synthwave, Khruangbin, 90s R&B…"
            value={seed}
            aria-describedby={
              formError === ""
                ? "radio-seed-hint"
                : "radio-seed-hint radio-form-error"
            }
            aria-invalid={formError !== ""}
            onChange={(event) => {
              setSeed(event.target.value);
              if (formError !== "") setFormError("");
            }}
          />
        </div>
        <fieldset className="radio-scope-fieldset">
          <legend>Taste source</legend>
          <div className="radio-scope-options">
            {SCOPE_OPTIONS.map((option) => (
              <label key={option.value} className="radio-scope-option">
                <input
                  type="radio"
                  name="scope"
                  value={option.value}
                  checked={scope === option.value}
                  onChange={() => {
                    setScope(option.value);
                    if (formError !== "") setFormError("");
                  }}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="radio-form-actions">
          <button type="submit" className="primary" disabled={busy}>
            {activeRadio === null ? "Start Radio" : "Update Radio"}
          </button>
        </div>
        {formError !== "" && (
          <p id="radio-form-error" role="alert" className="inline-error">
            {formError}
          </p>
        )}
      </form>
    </div>
  );
}
