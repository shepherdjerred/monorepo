import { useId, useRef, useState } from "react";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { RemoteAction } from "@shepherdjerred/streambot/web/client/api.ts";
import {
  scopeDisplayLabel,
  tvPresetDisplayLabel,
  type WebStationScope,
  type WebTvPreset,
} from "./station-label.ts";

type TvBannerActiveStation = {
  readonly kind: "radio" | "tv";
  readonly scope: WebStationScope;
  readonly tvPreset?: WebTvPreset | undefined;
  readonly seed?: string | undefined;
};

type TvBannerStartInput = {
  readonly preset: WebTvPreset;
  readonly scope: WebStationScope;
  readonly seed?: string;
};

type TvBannerProps = {
  readonly activeStation: TvBannerActiveStation | null;
  readonly canPlay?: boolean | undefined;
  readonly busy: boolean;
  readonly onStart: (input: TvBannerStartInput) => void;
  readonly onStop: () => void;
};

const PRESET_OPTIONS: readonly WebTvPreset[] = [
  "my-mix",
  "continue-series",
  "sitcoms",
  "movies",
  "youtube",
];

const SCOPE_OPTIONS: readonly WebStationScope[] = ["room", "mine", "server"];

function activeSyncKey(station: TvBannerActiveStation | null): string {
  return station?.kind === "tv"
    ? `${station.tvPreset ?? "my-mix"}|${station.scope}|${station.seed ?? ""}`
    : "inactive";
}

function TvBanner({
  activeStation,
  canPlay = true,
  busy,
  onStart,
  onStop,
}: TvBannerProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const seedId = `${baseId}-seed`;
  const seedHintId = `${baseId}-seed-hint`;
  const errorId = `${baseId}-error`;
  const seedInputRef = useRef<HTMLInputElement>(null);
  const isTvActive = activeStation?.kind === "tv";

  const [preset, setPreset] = useState<WebTvPreset>(
    isTvActive ? (activeStation.tvPreset ?? "my-mix") : "my-mix",
  );
  const [scope, setScope] = useState<WebStationScope>(
    isTvActive ? activeStation.scope : "room",
  );
  const [seed, setSeed] = useState(
    isTvActive ? (activeStation.seed ?? "") : "",
  );
  const [formError, setFormError] = useState("");
  const [prevKey, setPrevKey] = useState(() => activeSyncKey(activeStation));

  const nextKey = activeSyncKey(activeStation);
  if (nextKey !== prevKey) {
    setPrevKey(nextKey);
    if (activeStation?.kind === "tv") {
      setPreset(activeStation.tvPreset ?? "my-mix");
      setScope(activeStation.scope);
      setSeed(activeStation.seed ?? "");
    }
  }

  return (
    <form
      aria-labelledby={headingId}
      method="post"
      action="/api/commands"
      className="tv-banner"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canPlay) {
          setFormError("Join a Discord voice channel first to start TV Mode.");
          seedInputRef.current?.focus();
          return;
        }
        setFormError("");
        const trimmedSeed = seed.trim();
        onStart({
          preset,
          scope,
          ...(trimmedSeed === "" ? {} : { seed: trimmedSeed }),
        });
      }}
    >
      <div className="tv-banner-header">
        <div>
          <p className="eyebrow">CONTINUOUS CHANNEL</p>
          <h2 id={headingId}>TV Mode</h2>
        </div>
        {isTvActive ? (
          <div role="status" className="tv-banner-status">
            <span className="station-badge">
              On air: {tvPresetDisplayLabel(activeStation.tvPreset)} ·{" "}
              {scopeDisplayLabel(activeStation.scope)}
              {activeStation.seed !== undefined && activeStation.seed !== ""
                ? ` · “${activeStation.seed}”`
                : ""}
            </span>
            <button
              type="button"
              className="station-stop"
              disabled={busy}
              onClick={onStop}
            >
              Stop TV
            </button>
          </div>
        ) : null}
      </div>

      <fieldset className="tv-banner-fieldset">
        <legend>Channel preset</legend>
        <div className="tv-banner-radios">
          {PRESET_OPTIONS.map((value) => {
            const optionId = `${baseId}-preset-${value}`;
            return (
              <div key={value} className="tv-banner-radio-option">
                <input
                  id={optionId}
                  name="tvPreset"
                  type="radio"
                  value={value}
                  checked={preset === value}
                  onChange={() => {
                    setPreset(value);
                    if (formError !== "") setFormError("");
                  }}
                />
                <label htmlFor={optionId}>{tvPresetDisplayLabel(value)}</label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="tv-banner-fieldset">
        <legend>Listener taste</legend>
        <div className="tv-banner-radios">
          {SCOPE_OPTIONS.map((value) => {
            const optionId = `${baseId}-scope-${value}`;
            return (
              <div key={value} className="tv-banner-radio-option">
                <input
                  id={optionId}
                  name="tvScope"
                  type="radio"
                  value={value}
                  checked={scope === value}
                  onChange={() => {
                    setScope(value);
                    if (formError !== "") setFormError("");
                  }}
                />
                <label htmlFor={optionId}>{scopeDisplayLabel(value)}</label>
              </div>
            );
          })}
        </div>
      </fieldset>

      <div className="tv-banner-seed">
        <label htmlFor={seedId}>Show, genre, or topic (optional)</label>
        <p id={seedHintId} className="radio-hint">
          Optional filter to steer episodes, movies, or videos.
        </p>
        <input
          ref={seedInputRef}
          id={seedId}
          name="seed"
          type="text"
          maxLength={200}
          enterKeyHint="done"
          aria-describedby={
            formError === "" ? seedHintId : `${seedHintId} ${errorId}`
          }
          aria-invalid={formError !== ""}
          placeholder="e.g. The Bear, sci-fi, retro gaming"
          value={seed}
          onChange={(event) => {
            setSeed(event.target.value);
            if (formError !== "") setFormError("");
          }}
        />
      </div>

      <div className="tv-banner-actions">
        <button type="submit" className="primary" disabled={busy}>
          {isTvActive ? "Update TV" : "Start TV"}
        </button>
      </div>
      {formError !== "" && (
        <p id={errorId} role="alert" className="inline-error">
          {formError}
        </p>
      )}
    </form>
  );
}

export function PlexTvBanner(props: {
  readonly snapshot?: WebSnapshot | null | undefined;
  readonly canPlay: boolean;
  readonly busy: boolean;
  readonly send?: ((action: RemoteAction) => void) | undefined;
}) {
  if (props.snapshot?.tvEnabled !== true) {
    return null;
  }
  return (
    <TvBanner
      activeStation={props.snapshot.station}
      canPlay={props.canPlay}
      busy={props.busy}
      onStart={({ preset, scope, seed }) => {
        props.send?.({
          action: "station",
          mode: "tv",
          tvPreset: preset,
          scope,
          ...(seed === undefined ? {} : { seed }),
        });
      }}
      onStop={() => {
        props.send?.({ action: "station", mode: "off" });
      }}
    />
  );
}
