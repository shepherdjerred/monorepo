import type {
  ReplayMapPoint,
  ReplayPresentationCapabilities,
} from "@scout-for-lol/replay";
import { replayClock } from "#src/lib/replay/share-state.ts";

export function ReplayEventJump({
  events,
  seek,
}: {
  events: ReplayPresentationCapabilities["timelineEvents"];
  seek: (timeSeconds: number, mapPoint?: ReplayMapPoint) => Promise<void>;
}) {
  if (events === undefined || events.length === 0) return null;
  const options = events.map(
    ({ timeSeconds, label, mapPoint, kind }, index) => ({
      kind,
      element: (
        <option
          key={`${String(timeSeconds)}-${label}-${mapPoint?.join(",") ?? ""}`}
          value={index + 1}
        >
          {replayClock(timeSeconds)} · {label}
        </option>
      ),
    }),
  );
  const objectives = options.filter(({ kind }) => kind !== "elimination");
  const eliminations = options.filter(({ kind }) => kind === "elimination");
  return (
    <label className="space-y-1 text-xs text-scout-subtle">
      <span className="block">Jump to event</span>
      <select
        value=""
        className="max-w-full rounded-md border border-scout-border bg-scout-canvas p-2 text-sm text-scout-ink"
        onChange={(event) => {
          const target = events[Number(event.currentTarget.value) - 1];
          if (target !== undefined)
            void seek(target.timeSeconds, target.mapPoint);
        }}
      >
        <option value="" disabled>
          Choose an event
        </option>
        {objectives.length > 0 && (
          <optgroup label="Objectives">
            {objectives.map(({ element }) => element)}
          </optgroup>
        )}
        {eliminations.length > 0 && (
          <optgroup label="Eliminations">
            {eliminations.map(({ element }) => element)}
          </optgroup>
        )}
      </select>
    </label>
  );
}
