import type { ReactNode } from "react";
import { PressButton } from "@shepherdjerred/discord-plays-web/controller/press-button.tsx";
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

/**
 * One pressable N64 control, styled over the shared PressButton (pointer
 * capture, multi-touch, haptic tick).
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
  return (
    <PressButton
      code={code}
      ariaLabel={`${typeof label === "string" ? label : code} (${hint})`}
      pressed={active}
      onPress={onPress}
      onRelease={onRelease}
      className={cx(
        "no-touch-callout relative inline-flex items-center justify-center font-display italic ring-1 ring-black/40 transition-[transform,box-shadow,filter] duration-75 select-none",
        SHAPES[shape],
        active
          ? cx(colours.lit, "translate-y-px shadow-button-press brightness-110")
          : cx(colours.rest, "shadow-button-rest"),
        className,
      )}
    >
      {label}
    </PressButton>
  );
}
