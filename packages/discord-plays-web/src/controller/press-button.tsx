import type { PointerEvent, ReactNode } from "react";

export type PressButtonProps = {
  /** The control this button holds while pressed. */
  readonly code: string;
  readonly pressed: boolean;
  readonly onPress: (code: string) => void;
  readonly onRelease: (code: string) => void;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly children: ReactNode;
};

/** A short haptic tick on touch screens that support it. */
function buzz(event: PointerEvent): void {
  if (
    event.pointerType === "touch" &&
    typeof navigator.vibrate === "function"
  ) {
    navigator.vibrate(8);
  }
}

/**
 * An unstyled on-screen controller button. Each game styles it to look like
 * its own hardware.
 *
 * Pointer capture keeps the press until that finger lifts even if it drifts
 * off the button, and each finger is its own pointer, so several controls can
 * be held at once on a touch screen. A long press never opens the context menu.
 */
export function PressButton({
  code,
  pressed,
  onPress,
  onRelease,
  ariaLabel,
  className,
  disabled = false,
  children,
}: PressButtonProps) {
  const end = () => {
    onRelease(code);
  };
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      disabled={disabled}
      className={className}
      onKeyDown={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) onPress(code);
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        end();
      }}
      onBlur={end}
      onClick={(event) => {
        // Assistive activation may emit a click without pointer/key events.
        if (event.detail !== 0) return;
        onPress(code);
        onRelease(code);
      }}
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
      {children}
    </button>
  );
}
