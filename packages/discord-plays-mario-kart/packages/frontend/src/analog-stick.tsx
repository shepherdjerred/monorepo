import { type ControlDefinition } from "./input-map.ts";
import { isControlPressed } from "./controller-ui.tsx";

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

function StickChevron({
  control,
  pressed,
  onPress,
  onRelease,
  className,
}: {
  control: ControlDefinition;
  pressed: boolean;
  onPress: (code: string) => void;
  onRelease: (code: string) => void;
  className: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Analog stick ${control.label} ${control.sublabel}`}
      aria-pressed={pressed}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        onPress(control.code);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onRelease(control.code);
      }}
      onPointerCancel={() => {
        onRelease(control.code);
      }}
      onPointerLeave={() => {
        onRelease(control.code);
      }}
      className={cx(
        "absolute z-40 flex h-6 w-6 touch-none flex-col items-center justify-center rounded-md border text-[10px] font-black leading-none transition active:translate-y-0 sm:h-7 sm:w-7",
        pressed
          ? "border-white bg-white text-zinc-950 shadow-[0_0_14px_rgba(255,255,255,0.55)]"
          : "border-zinc-900 bg-zinc-800/90 text-zinc-100 shadow-[inset_0_1px_2px_rgba(255,255,255,0.18),0_2px_4px_rgba(0,0,0,0.45)] hover:bg-zinc-700/90",
        className,
      )}
    >
      <span className="text-[8px] leading-none opacity-70" aria-hidden="true">
        {control.label}
      </span>
      <span className="text-[10px] font-black leading-none">
        {control.sublabel}
      </span>
    </button>
  );
}

export function AnalogStick({
  leftControl,
  rightControl,
  upControl,
  downControl,
  axisX,
  axisY,
  pressedCodes,
  onPress,
  onRelease,
}: {
  leftControl: ControlDefinition;
  rightControl: ControlDefinition;
  upControl: ControlDefinition;
  downControl: ControlDefinition;
  axisX: number;
  axisY: number;
  pressedCodes: Set<string>;
  onPress: (code: string) => void;
  onRelease: (code: string) => void;
}) {
  const knobShiftX = `${String(axisX * 18)}px`;
  const knobShiftY = `${String(-axisY * 18)}px`;
  const leftPressed = isControlPressed(leftControl, pressedCodes);
  const rightPressed = isControlPressed(rightControl, pressedCodes);
  const upPressed = isControlPressed(upControl, pressedCodes);
  const downPressed = isControlPressed(downControl, pressedCodes);
  const anyPressed = leftPressed || rightPressed || upPressed || downPressed;
  return (
    <div className="relative h-28 w-28 sm:h-32 sm:w-32">
      {/* Outer hex boot (the recessed well on the real N64) */}
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 sm:h-28 sm:w-28">
        <div
          className={cx(
            "absolute inset-0 rounded-full border border-zinc-950 bg-gradient-to-br from-zinc-600 via-zinc-800 to-zinc-950 shadow-[inset_0_6px_14px_rgba(0,0,0,0.65),0_8px_14px_rgba(0,0,0,0.35)]",
            anyPressed && "ring-2 ring-white/40",
          )}
        />
        {/* Inner well that the stick sits in (darker dome) */}
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-br from-zinc-900 via-black to-zinc-950 shadow-[inset_0_4px_10px_rgba(0,0,0,0.85)] sm:h-20 sm:w-20" />
        {/* White stick knob translates in 2D */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-9 w-9 rounded-full border border-zinc-700 bg-gradient-to-br from-white via-zinc-200 to-zinc-400 shadow-[inset_0_2px_3px_rgba(255,255,255,0.7),0_3px_6px_rgba(0,0,0,0.55)] sm:h-10 sm:w-10"
          style={{
            transform: `translate(calc(-50% + ${knobShiftX}), calc(-50% + ${knobShiftY}))`,
          }}
        />
        {/* Center dot to evoke the real N64 stick top */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-30 h-1 w-1 rounded-full bg-zinc-500"
          style={{
            transform: `translate(calc(-50% + ${knobShiftX}), calc(-50% + ${knobShiftY}))`,
          }}
        />
      </div>
      <StickChevron
        control={upControl}
        pressed={upPressed}
        onPress={onPress}
        onRelease={onRelease}
        className="left-1/2 top-0 -translate-x-1/2"
      />
      <StickChevron
        control={downControl}
        pressed={downPressed}
        onPress={onPress}
        onRelease={onRelease}
        className="bottom-0 left-1/2 -translate-x-1/2"
      />
      <StickChevron
        control={leftControl}
        pressed={leftPressed}
        onPress={onPress}
        onRelease={onRelease}
        className="left-0 top-1/2 -translate-y-1/2"
      />
      <StickChevron
        control={rightControl}
        pressed={rightPressed}
        onPress={onPress}
        onRelease={onRelease}
        className="right-0 top-1/2 -translate-y-1/2"
      />
    </div>
  );
}
