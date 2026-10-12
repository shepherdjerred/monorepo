import type { PlayerInputState } from "@discord-plays-mario-kart/common";
import { cx } from "#src/ui/cx.ts";
import { ControlButton, type ControlTone } from "./control-button.tsx";
import { isCodeActive } from "./pressed.ts";

export type DirectionCodes = {
  readonly up: string;
  readonly down: string;
  readonly left: string;
  readonly right: string;
};

const ARROWS = { up: "▲", down: "▼", left: "◀", right: "▶" } as const;

/**
 * Four buttons in a cross: the D-pad (`square` keys on a plus-shaped plate)
 * or the C-button diamond (`round` yellow buttons).
 */
export function DirectionPad({
  codes,
  hints,
  label,
  state,
  onPress,
  onRelease,
  tone,
  variant,
  buttonSize,
  className,
}: {
  codes: DirectionCodes;
  hints: DirectionCodes;
  label: string;
  state: PlayerInputState;
  onPress: (code: string) => void;
  onRelease: (code: string) => void;
  tone: ControlTone;
  variant: "dpad" | "c";
  /** Edge length of one button in px. */
  buttonSize: number;
  className?: string;
}) {
  const size = buttonSize * 3;
  const directions = ["up", "left", "right", "down"] as const;
  const position = {
    up: { left: buttonSize, top: 0 },
    left: { left: 0, top: buttonSize },
    right: { left: buttonSize * 2, top: buttonSize },
    down: { left: buttonSize, top: buttonSize * 2 },
  };
  return (
    <div
      role="group"
      aria-label={label}
      className={cx("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {variant === "dpad" ? (
        <>
          <div
            className="absolute rounded-md bg-[#151820] ring-1 ring-white/5"
            style={{
              left: buttonSize,
              top: 0,
              width: buttonSize,
              height: size,
            }}
          />
          <div
            className="absolute rounded-md bg-[#151820] ring-1 ring-white/5"
            style={{
              left: 0,
              top: buttonSize,
              width: size,
              height: buttonSize,
            }}
          />
        </>
      ) : null}
      {directions.map((direction) => (
        <div
          key={direction}
          className="absolute flex items-center justify-center"
          style={{
            ...position[direction],
            width: buttonSize,
            height: buttonSize,
          }}
        >
          <ControlButton
            code={codes[direction]}
            label={
              <span className="text-[0.7em] leading-none">
                {ARROWS[direction]}
              </span>
            }
            hint={hints[direction]}
            active={isCodeActive(codes[direction], state)}
            onPress={onPress}
            onRelease={onRelease}
            tone={tone}
            shape={variant === "dpad" ? "square" : "round"}
            className={variant === "dpad" ? "size-full" : "size-[86%]"}
          />
        </div>
      ))}
    </div>
  );
}
