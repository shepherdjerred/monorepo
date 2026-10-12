import { useRef } from "react";
import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import {
  CENTERED,
  stickVectorFromPointer,
  type StickVector,
} from "#src/input/analog.ts";
import { cx } from "#src/ui/cx.ts";

/**
 * A draggable analog stick. Dragging anywhere in the well sets a true vector
 * (with a deadzone); releasing springs it back to centre. The knob shows the
 * merged state, so keyboard and gamepad steering move it too.
 */
export function TouchStick({
  state,
  onStick,
  size = 132,
  className,
}: {
  state: PlayerInputState;
  onStick: (vector: StickVector) => void;
  /** Well diameter in px. */
  size?: number;
  className?: string;
}) {
  const centre = useRef<{ x: number; y: number }>(undefined);
  const travel = size * 0.32;
  const knob = size * 0.46;

  const move = (clientX: number, clientY: number) => {
    const origin = centre.current;
    if (origin === undefined) {
      return;
    }
    onStick(
      stickVectorFromPointer(clientX - origin.x, clientY - origin.y, travel),
    );
  };
  const end = () => {
    centre.current = undefined;
    onStick(CENTERED);
  };

  const engaged = state.analogX !== 0 || state.analogY !== 0;

  return (
    <div
      role="slider"
      aria-label="Analog stick (A/D steer, R/F up and down)"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(state.analogX * 100)}
      tabIndex={-1}
      className={cx(
        "no-touch-callout relative shrink-0 cursor-grab rounded-full bg-[radial-gradient(circle_at_50%_40%,#1d2130,#0b0d13_70%)] ring-1 ring-white/8 shadow-[inset_0_6px_18px_rgb(0_0_0/0.7),0_1px_0_rgb(255_255_255/0.05)] active:cursor-grabbing",
        className,
      )}
      style={{ width: size, height: size }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const rect = event.currentTarget.getBoundingClientRect();
        centre.current = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        move(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        move(event.clientX, event.clientY);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      {/* Octagonal gate, like the N64's. */}
      <div
        className="absolute inset-[12%] bg-white/[0.03] ring-1 ring-white/6"
        style={{
          clipPath:
            "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)",
        }}
      />
      <div
        className={cx(
          "absolute top-1/2 left-1/2 rounded-full bg-[radial-gradient(circle_at_40%_30%,#5a6175,#2b303d_65%)] ring-1 ring-black/50 shadow-[0_6px_14px_rgb(0_0_0/0.6)] transition-transform duration-75",
          engaged && "ring-brand/50",
        )}
        style={{
          width: knob,
          height: knob,
          transform: `translate(calc(-50% + ${String(state.analogX * travel)}px), calc(-50% + ${String(-state.analogY * travel)}px))`,
        }}
      >
        <div className="absolute inset-[22%] rounded-full bg-[repeating-radial-gradient(circle,#3a4050_0_2px,#2f3442_2px_4px)] opacity-70" />
      </div>
    </div>
  );
}
