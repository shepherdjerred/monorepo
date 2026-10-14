import { useEffect, useRef, type PointerEvent } from "react";

export function AnalogStick({
  label,
  x,
  y,
  disabled,
  change,
}: {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly disabled: boolean;
  readonly change: (x: number, y: number) => void;
}) {
  const pointer = useRef<number | null>(null);
  const callback = useRef(change);
  callback.current = change;
  useEffect(() => {
    const reset = () => {
      pointer.current = null;
      callback.current(0, 0);
    };
    globalThis.addEventListener("blur", reset);
    return () => {
      globalThis.removeEventListener("blur", reset);
    };
  }, []);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || pointer.current !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const radius = bounds.width / 2;
    const rawX = (event.clientX - bounds.left - radius) / radius;
    const rawY = -(event.clientY - bounds.top - radius) / radius;
    const scale = Math.max(1, Math.hypot(rawX, rawY));
    change(
      Math.round((rawX / scale) * 100) / 100,
      Math.round((rawY / scale) * 100) / 100,
    );
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    change(0, 0);
  };
  return (
    <div className="analog-control">
      <span>{label}</span>
      <div
        className="analog-well"
        aria-label={`${label} touch control`}
        aria-disabled={disabled}
        onPointerDown={(event) => {
          if (disabled || pointer.current !== null) return;
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          move(event);
        }}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
      >
        <i
          style={{
            transform: `translate(${String(x * 30)}px, ${String(-y * 30)}px)`,
          }}
        />
      </div>
    </div>
  );
}
