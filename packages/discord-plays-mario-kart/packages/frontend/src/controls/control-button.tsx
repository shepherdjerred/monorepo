import type { PointerEvent, ReactNode } from "react";
import { cx } from "#src/ui/cx.ts";

export type ControlTone = "a" | "b" | "c" | "start" | "z" | "neutral";
export type ControlShape = "round" | "pill" | "square";

const TONES: Record<ControlTone, { rest: string; lit: string }> = {
  a: {
    rest: "bg-gradient-to-b from-[#4c8ff8] to-[#2563eb] text-white",
    lit: "bg-gradient-to-b from-[#93c5fd] to-[#3b82f6] text-white",
  },
  b: {
    rest: "bg-gradient-to-b from-[#34d36e] to-[#15a34a] text-white",
    lit: "bg-gradient-to-b from-[#86efac] to-[#22c55e] text-white",
  },
  c: {
    rest: "bg-gradient-to-b from-[#fde047] to-[#eab308] text-yellow-950",
    lit: "bg-gradient-to-b from-[#fef9c3] to-[#facc15] text-yellow-950",
  },
  start: {
    rest: "bg-gradient-to-b from-[#f87171] to-[#dc2626] text-white",
    lit: "bg-gradient-to-b from-[#fecaca] to-[#ef4444] text-white",
  },
  z: {
    rest: "bg-gradient-to-b from-[#4b5263] to-[#2c313d] text-ink",
    lit: "bg-gradient-to-b from-[#8b93a7] to-[#5b6274] text-white",
  },
  neutral: {
    rest: "bg-gradient-to-b from-[#2a2f3b] to-[#1b1f28] text-ink-muted",
    lit: "bg-gradient-to-b from-[#4b5568] to-[#343b4a] text-white",
  },
};

const SHAPES: Record<ControlShape, string> = {
  round: "rounded-full",
  pill: "rounded-full",
  square: "rounded-lg",
};

function buzz(event: PointerEvent): void {
  if (
    event.pointerType === "touch" &&
    typeof navigator.vibrate === "function"
  ) {
    navigator.vibrate(8);
  }
}

/**
 * One pressable N64 control. Pointer capture keeps the press until that finger
 * lifts even if it drifts off the button, and each finger is its own pointer,
 * so several controls can be held at once on a touch screen.
 */
export function ControlButton({
  code,
  label,
  hint,
  active,
  onPress,
  onRelease,
  tone = "neutral",
  shape = "round",
  className,
}: {
  code: string;
  label: ReactNode;
  /** Accessible description, e.g. the keyboard binding. */
  hint: string;
  active: boolean;
  onPress: (code: string) => void;
  onRelease: (code: string) => void;
  tone?: ControlTone;
  shape?: ControlShape;
  className?: string;
}) {
  const colours = TONES[tone];
  const end = () => {
    onRelease(code);
  };
  return (
    <button
      type="button"
      aria-label={`${typeof label === "string" ? label : code} (${hint})`}
      aria-pressed={active}
      className={cx(
        "no-touch-callout relative inline-flex items-center justify-center font-bold ring-1 ring-black/40 transition-[transform,box-shadow,filter] duration-75 select-none",
        SHAPES[shape],
        active
          ? cx(colours.lit, "translate-y-px shadow-button-press brightness-110")
          : cx(colours.rest, "shadow-button-rest"),
        className,
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        buzz(event);
        onPress(code);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      {label}
    </button>
  );
}
