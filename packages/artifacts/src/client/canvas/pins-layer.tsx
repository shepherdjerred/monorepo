/**
 * Comment pins on the unscaled overlay. A pin is a world position: a board pin
 * stores one, a frame pin gets one from its frame's `AnchorAdapter` (the same
 * adapters the focused view uses). Positions are measured when the camera
 * settles or a frame's view changes; while the camera moves each marker follows
 * through the camera like any other overlay item, so pins stay glued to the
 * world without a render per frame.
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { clusterPins } from "#client/lib/cluster.ts";
import type { Point } from "#client/lib/geometry.ts";
import { describePin } from "#client/viewers/pins-overlay.tsx";
import type { AnchorAdapter } from "#client/viewers/types.ts";
import {
  screenToWorld,
  worldToScreen,
  type Camera,
  type WorldRect,
} from "./camera.ts";
import type { CameraController } from "./controller.ts";
import { useFollowCamera } from "./follow.ts";
import type { CanvasPin } from "./model.ts";

type Placed = {
  readonly key: string;
  readonly pins: readonly CanvasPin[];
  readonly world: Point;
  readonly approximate: boolean;
};

/** How far outside its frame a frame pin may measure before it is dropped (it scrolled away). */
const FRAME_SLACK_PX = 12;

type MeasureInput = {
  readonly pins: readonly CanvasPin[];
  readonly camera: Camera;
  readonly origin: Point;
  readonly rects: ReadonlyMap<string, WorldRect>;
  readonly adapters: ReadonlyMap<string, { current: AnchorAdapter | null }>;
};

/** Pure enough to test: the world position of every pin that can be placed now. */
export function measurePins({
  pins,
  camera,
  origin,
  rects,
  adapters,
}: MeasureInput): Placed[] {
  const found: { pin: CanvasPin; world: Point; approximate: boolean }[] = [];
  for (const pin of pins) {
    if (pin.frameId === null) {
      if (pin.anchor.type === "board")
        found.push({
          pin,
          world: { x: pin.anchor.x, y: pin.anchor.y },
          approximate: false,
        });
      continue;
    }
    const adapter = adapters.get(pin.frameId)?.current;
    const rect = rects.get(pin.frameId);
    const client = adapter?.toClient(pin.anchor) ?? null;
    if (
      adapter === undefined ||
      adapter === null ||
      rect === undefined ||
      client === null
    )
      continue;
    const world = screenToWorld(camera, {
      x: client.x - origin.x,
      y: client.y - origin.y,
    });
    const slack = FRAME_SLACK_PX / camera.s;
    if (
      world.x < rect.x - slack ||
      world.y < rect.y - slack ||
      world.x > rect.x + rect.w + slack ||
      world.y > rect.y + rect.h + slack
    )
      continue;
    found.push({
      pin,
      world,
      approximate: adapter.approximate?.(pin.anchor) === true,
    });
  }
  const byId = new Map(found.map((entry) => [entry.pin.id, entry]));
  const clusters = clusterPins(
    found.map(({ pin, world }) => ({
      id: pin.id,
      ...worldToScreen(camera, world),
    })),
  );
  return clusters.flatMap((cluster) => {
    const members = cluster.ids.flatMap((id) => byId.get(id) ?? []);
    if (members.length === 0) return [];
    const count = members.length;
    return [
      {
        key: cluster.ids.join(","),
        pins: members.map((member) => member.pin),
        world: {
          x: members.reduce((sum, member) => sum + member.world.x, 0) / count,
          y: members.reduce((sum, member) => sum + member.world.y, 0) / count,
        },
        approximate: members.some((member) => member.approximate),
      },
    ];
  });
}

function PinMarker({
  controller,
  placed,
  selectedId,
  onSelect,
}: {
  readonly controller: CameraController;
  readonly placed: Placed;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
}): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const { world, pins, approximate } = placed;
  const place = useCallback(
    (camera: Camera, element: HTMLElement) => {
      element.style.transform = `translate(${String(camera.x + world.x * camera.s)}px, ${String(camera.y + world.y * camera.s)}px)`;
    },
    [world.x, world.y],
  );
  useFollowCamera(controller, ref, place);
  const [first] = pins;
  if (first === undefined) return null;
  const selected = pins.some((pin) => pin.id === selectedId);
  const next =
    pins.length > 1
      ? (pins[
          (pins.findIndex((pin) => pin.id === selectedId) + 1) % pins.length
        ] ?? first)
      : first;
  return (
    <div ref={ref} className="ar-cv-pin" data-cv-ignore="">
      <button
        type="button"
        className="ar-pin"
        data-testid="pin"
        data-selected={selected}
        data-hollow={pins.every((pin) => pin.stale)}
        data-resolved={pins.every((pin) => pin.state === "resolved")}
        data-approximate={approximate}
        data-board-pin={first.frameId === null}
        aria-pressed={selected}
        aria-label={
          pins.length === 1
            ? describePin(first)
            : `${String(pins.length)} threads: ${pins.map((pin) => String(pin.index)).join(", ")}`
        }
        title={approximate ? "Approximate position" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(next.id);
        }}
      >
        {pins.length === 1 ? first.index : pins.length}
      </button>
    </div>
  );
}

export function PinsLayer({
  controller,
  viewport,
  pins,
  rects,
  adapters,
  settled,
  tick,
  selectedId,
  onSelect,
}: {
  readonly controller: CameraController;
  readonly viewport: HTMLElement | null;
  readonly pins: readonly CanvasPin[];
  readonly rects: ReadonlyMap<string, WorldRect>;
  readonly adapters: ReadonlyMap<string, { current: AnchorAdapter | null }>;
  /** The settled camera: pins are measured again when it changes. */
  readonly settled: Camera;
  /** Bumped when a frame's own view changed (its page scrolled, it finished drawing). */
  readonly tick: number;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
}): React.JSX.Element {
  const [placed, setPlaced] = useState<readonly Placed[]>([]);

  useLayoutEffect(() => {
    if (viewport === null) {
      setPlaced([]);
      return;
    }
    const box = viewport.getBoundingClientRect();
    setPlaced(
      measurePins({
        pins,
        // The DOM is at the settled camera here, so the live camera and the
        // settled one agree; the live one is also right for a tick mid-motion.
        camera: controller.get(),
        origin: { x: box.left, y: box.top },
        rects,
        adapters,
      }),
    );
    // `settled` and `tick` are the triggers; the rest are inputs.
  }, [controller, viewport, pins, rects, adapters, settled, tick]);

  return (
    <div className="ar-cv-pins" data-testid="canvas-pins">
      {placed.map((entry) => (
        <PinMarker
          key={entry.key}
          controller={controller}
          placed={entry}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
