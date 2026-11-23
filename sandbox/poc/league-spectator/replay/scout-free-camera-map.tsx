import { useImperativeHandle, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, Ref } from "react";

type MapPoint = [number, number];

export interface FreeCameraMapDot {
  participantId: number;
  teamId: 100 | 200;
  point: readonly [number, number];
}

export interface FreeCameraMapHandle {
  drawDots(dots: readonly FreeCameraMapDot[]): void;
}

interface FreeCameraMapProps {
  target: MapPoint | null;
  turrets?: readonly { context: number; point: MapPoint }[];
  mapHandle?: Ref<FreeCameraMapHandle>;
  onMove: (point: MapPoint) => void;
  onReset: () => void;
}

const center: MapPoint = [0.5, 0.5];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const step = 0.05;
const arrows = new Map<string, MapPoint>([
  ["ArrowUp", [0, -step]],
  ["ArrowDown", [0, step]],
  ["ArrowLeft", [-step, 0]],
  ["ArrowRight", [step, 0]],
]);

function describePoint([x, y]: MapPoint) {
  const northSouth = y < 1 / 3 ? "north" : y > 2 / 3 ? "south" : "";
  const eastWest = x < 1 / 3 ? "west" : x > 2 / 3 ? "east" : "";
  return northSouth + eastWest || "center";
}

function validMapCoordinate(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function createDot(layer: HTMLSpanElement, participantId: number) {
  const node = layer.ownerDocument.createElement("span");
  node.dataset.minimapDot = String(participantId);
  Object.assign(node.style, {
    position: "absolute",
    width: "8px",
    height: "8px",
    boxSizing: "border-box",
    transform: "translate(-50%, -50%)",
    border: "1px solid #071719",
    pointerEvents: "none",
  });
  layer.appendChild(node);
  return node;
}

export function FreeCameraMap({
  target,
  turrets,
  mapHandle,
  onMove,
  onReset,
}: FreeCameraMapProps) {
  const pointerId = useRef<number | null>(null);
  const dotLayer = useRef<HTMLSpanElement>(null);
  const dotNodes = useRef(new Map<number, HTMLSpanElement>());
  const [announcement, setAnnouncement] = useState("");

  useImperativeHandle(
    mapHandle,
    () => ({
      drawDots(dots) {
        const layer = dotLayer.current;
        if (!layer) return;
        const activeIds = new Set<number>();
        for (const {
          participantId,
          teamId,
          point: [x, y],
        } of dots) {
          if (
            !Number.isSafeInteger(participantId) ||
            participantId < 0 ||
            activeIds.has(participantId) ||
            (teamId !== 100 && teamId !== 200) ||
            !validMapCoordinate(x) ||
            !validMapCoordinate(y)
          )
            throw Error("Invalid roster dot for free camera map");
          activeIds.add(participantId);
        }

        const nodes = dotNodes.current;
        for (const {
          participantId,
          teamId,
          point: [x, y],
        } of dots) {
          let node = nodes.get(participantId);
          if (!node) {
            node = createDot(layer, participantId);
            nodes.set(participantId, node);
          }
          const team = String(teamId);
          if (node.dataset.team !== team) {
            node.dataset.team = team;
            node.style.backgroundColor = teamId === 100 ? "#77e5ff" : "#ff99ad";
            node.style.borderRadius = teamId === 100 ? "50%" : "1px";
          }
          node.style.left = `${x * 100}%`;
          node.style.top = `${y * 100}%`;
        }
        for (const [id, node] of nodes) {
          if (activeIds.has(id)) continue;
          node.remove();
          nodes.delete(id);
        }
      },
    }),
    [],
  );

  function move(x: number, y: number) {
    const point: MapPoint = [clamp(x), clamp(y)];
    onMove(point);
    return point;
  }

  function moveToPointer(event: PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return move(
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height,
    );
  }

  function reset() {
    onReset();
    setAnnouncement("Camera reset");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Home") {
      event.preventDefault();
      reset();
      return;
    }
    const delta = arrows.get(event.key);
    if (!delta) return;
    event.preventDefault();
    const [dx, dy] = delta;
    const [x, y] = target ?? center;
    setAnnouncement("Camera at " + describePoint(move(x + dx, y + dy)));
  }

  function startPointer(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0 || pointerId.current !== null)
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerId.current = event.pointerId;
    moveToPointer(event);
  }

  function endPointer(event: PointerEvent<HTMLButtonElement>) {
    if (pointerId.current !== event.pointerId) return;
    setAnnouncement("Camera at " + describePoint(moveToPointer(event)));
    pointerId.current = null;
  }

  function cancelPointer(event: PointerEvent<HTMLButtonElement>) {
    if (pointerId.current === event.pointerId) pointerId.current = null;
  }

  return (
    <div style={{ display: "inline-grid", gap: 6, justifyItems: "center" }}>
      <button
        type="button"
        aria-label={`Free camera map. Use arrow keys to move or Home to reset.${turrets === undefined ? "" : " Gold diamonds show standing turrets."}`}
        onKeyDown={handleKeyDown}
        onPointerDown={startPointer}
        onPointerMove={(event) => {
          if (
            pointerId.current === event.pointerId &&
            event.currentTarget.hasPointerCapture(event.pointerId)
          )
            moveToPointer(event);
        }}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        onLostPointerCapture={cancelPointer}
        onClick={(event) => {
          if (event.detail === 0) {
            const point = move(...(target ?? center));
            setAnnouncement("Camera at " + describePoint(point));
          }
        }}
        style={{
          position: "relative",
          display: "block",
          width: "clamp(96px, 18vw, 148px)",
          aspectRatio: "1",
          padding: 0,
          border: 0,
          borderRadius: 4,
          boxShadow: "0 0 0 1px #54756d",
          background: "#172a2a",
          cursor: "crosshair",
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        <img
          src="/minimap.png"
          alt=""
          draggable={false}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            borderRadius: 4,
          }}
        />
        {turrets?.map(({ context, point: [x, y] }) => (
          <span
            key={context}
            data-minimap-turret={context}
            aria-hidden="true"
            style={{
              position: "absolute",
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              width: 7,
              height: 7,
              boxSizing: "border-box",
              transform: "translate(-50%, -50%) rotate(45deg)",
              border: "1px solid #071719",
              background: "#fff0a3",
              pointerEvents: "none",
            }}
          />
        ))}
        <span
          ref={dotLayer}
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        />
        {target && (
          <span
            aria-hidden="true"
            data-camera-target=""
            style={{
              position: "absolute",
              left: `${target[0] * 100}%`,
              top: `${target[1] * 100}%`,
              width: 11,
              height: 11,
              transform: "translate(-50%, -50%)",
              border: "2px solid #f9f3d7",
              borderRadius: "50%",
              boxShadow: "0 0 0 1px #0b1719",
              pointerEvents: "none",
            }}
          />
        )}
      </button>
      <button
        type="button"
        onClick={reset}
        style={{
          minHeight: 32,
          padding: "3px 8px",
          border: "1px solid #54756d",
          borderRadius: 4,
          background: "#172a2a",
          color: "#f2f5ee",
          font: "inherit",
          fontSize: "0.75rem",
          cursor: "pointer",
        }}
      >
        Reset camera
      </button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
