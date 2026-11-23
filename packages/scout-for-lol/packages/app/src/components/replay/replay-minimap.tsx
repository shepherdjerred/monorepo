import { useId } from "react";
import type {
  ReplayMapActor,
  ReplayMapPoint,
} from "@scout-for-lol/replay/types";

const step = 0.05;
const arrows = new Map<string, ReplayMapPoint>([
  ["ArrowUp", [0, -step]],
  ["ArrowDown", [0, step]],
  ["ArrowLeft", [-step, 0]],
  ["ArrowRight", [step, 0]],
]);

const actorColor = {
  100: "rounded-full bg-sky-400",
  200: "rotate-45 bg-rose-400",
};

function ReplayMinimapActors({
  actors,
}: {
  actors: readonly ReplayMapActor[] | undefined;
}) {
  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden="true">
      {actors?.map(({ id, kind, point, teamId }) => (
        <span
          key={`${kind}-${String(id)}`}
          data-map-actor={kind}
          data-map-actor-id={id}
          data-map-actor-team={teamId}
          className={`absolute -translate-1/2 ${actorColor[teamId]} ${kind === "champion" ? "z-10 size-2 border border-black" : "size-1 opacity-80"}`}
          style={{
            left: `${String(point[0] * 100)}%`,
            top: `${String(point[1] * 100)}%`,
          }}
        />
      ))}
    </span>
  );
}

export function ReplayMinimap({
  url,
  point,
  actors,
  onMove,
  onReset,
}: {
  url: string;
  point: ReplayMapPoint;
  actors: readonly ReplayMapActor[] | undefined;
  onMove: (point: ReplayMapPoint) => void;
  onReset: () => void;
}) {
  const instructions = useId();
  return (
    <button
      type="button"
      aria-label="Replay minimap"
      aria-describedby={instructions}
      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home"
      className="absolute right-2 bottom-2 z-10 aspect-square w-1/4 min-w-6 max-w-36 cursor-crosshair overflow-hidden rounded border border-scout-border bg-scout-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-scout-brand"
      onClick={(event) => {
        if (event.detail === 0) {
          onMove(point);
          return;
        }
        const rect = event.currentTarget
          .querySelector("img")
          ?.getBoundingClientRect();
        if (rect === undefined || rect.width === 0 || rect.height === 0) return;
        onMove([
          (event.clientX - rect.left) / rect.width,
          (event.clientY - rect.top) / rect.height,
        ]);
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
          return;
        if (event.key === "Home") {
          event.preventDefault();
          onReset();
          return;
        }
        const delta = arrows.get(event.key);
        if (delta === undefined) return;
        event.preventDefault();
        onMove([point[0] + delta[0], point[1] + delta[1]]);
      }}
    >
      <img src={url} alt="" draggable={false} className="h-full w-full" />
      <ReplayMinimapActors actors={actors} />
      <span id={instructions} className="sr-only">
        Choose a location to move the free camera. Use the arrow keys to move or
        Home for the map overview.
      </span>
      <span
        aria-hidden="true"
        data-camera-target=""
        className="pointer-events-none absolute z-20 size-3 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_black]"
        style={{
          left: `${(point[0] * 100).toString()}%`,
          top: `${(point[1] * 100).toString()}%`,
        }}
      />
    </button>
  );
}
