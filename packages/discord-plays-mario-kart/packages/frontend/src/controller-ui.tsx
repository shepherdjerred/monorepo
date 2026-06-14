import type { ReactNode } from "react";
import { type ControlDefinition, controlCodes } from "./input-map.ts";

type ControlVariant =
  | "dpad"
  | "faceA"
  | "faceB"
  | "c"
  | "shoulder"
  | "start"
  | "z";

function cx(...parts: (string | false | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function isControlPressed(
  control: ControlDefinition,
  pressedCodes: Set<string>,
) {
  return controlCodes(control).some((code) => pressedCodes.has(code));
}

export function N64ControllerShell() {
  // Top-down silhouette of an N64 controller, traced from the reference photo:
  // wide body with a central hump for the Nintendo plate, two chunky outer
  // handles, one narrower center prong with the analog stick well, and tiny
  // L/R shoulder humps peeking off the back-top corners.
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 900 540"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="n64Plastic" cx="50%" cy="22%" r="80%">
          <stop offset="0%" stopColor="#eeeff1" />
          <stop offset="55%" stopColor="#cccdd1" />
          <stop offset="100%" stopColor="#9a9aa0" />
        </radialGradient>
        <radialGradient id="n64Well" cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#2e2e32" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#0a0a0c" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="n64StickWell" cx="50%" cy="38%" r="60%">
          <stop offset="0%" stopColor="#141417" />
          <stop offset="100%" stopColor="#33333a" />
        </radialGradient>
        <filter id="n64Drop" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="12" stdDeviation="14" floodOpacity="0.42" />
        </filter>
      </defs>

      {/* Whole-controller silhouette: body + central top hump + two chunky
          outer handles + a LONGER center prong (extends below the side
          handles, matching the reference photo). Clockwise from top-left.
          L/R shoulder visualization is the button widgets themselves. */}
      <path
        d="
          M 140 90
          C 145 86 165 84 200 84
          L 380 84
          C 388 70 396 48 415 30
          C 432 22 468 22 485 30
          C 504 48 512 70 520 84
          L 700 84
          C 735 84 755 86 760 90
          C 800 102 825 150 830 220
          C 838 282 838 332 815 372
          C 790 408 745 418 712 405
          C 678 392 644 360 615 320
          C 600 300 580 290 558 300
          C 545 308 540 322 545 360
          C 555 420 552 478 538 510
          C 526 532 510 540 488 540
          L 412 540
          C 390 540 374 532 362 510
          C 348 478 345 420 355 360
          C 360 322 355 308 342 300
          C 320 290 300 300 285 320
          C 256 360 222 392 188 405
          C 155 418 110 408 85 372
          C 62 332 62 282 70 220
          C 75 150 100 102 140 90
          Z
        "
        fill="url(#n64Plastic)"
        filter="url(#n64Drop)"
      />

      {/* Nintendo wordmark — embossed plate on the central hump, styled to
          look like the recessed silver oval on the real controller. */}
      <ellipse
        cx="450"
        cy="55"
        rx="62"
        ry="14"
        fill="#bcbcc0"
        stroke="#878790"
        strokeWidth="1"
        opacity="0.85"
      />
      <text
        x="450"
        y="60"
        textAnchor="middle"
        className="fill-zinc-700 text-[13px] font-bold italic"
        style={{ fontFamily: "Georgia, serif" }}
      >
        Nintendo
      </text>

      {/* Recessed wells — centered on the live button clusters (DOM-measured
          centers, then mapped to SVG coords so the wells match the buttons). */}
      <ellipse cx="207" cy="272" rx="84" ry="74" fill="url(#n64Well)" />
      <ellipse cx="747" cy="268" rx="84" ry="74" fill="url(#n64Well)" />
      <ellipse cx="540" cy="324" rx="78" ry="56" fill="url(#n64Well)" />

      {/* Deep analog stick well — sized to fully contain the stick chevrons
          (the touch-zone buttons around the disc) so they don't appear to
          float in the gray plastic. */}
      <circle
        cx="450"
        cy="400"
        r="80"
        fill="url(#n64StickWell)"
        opacity="0.95"
      />
    </svg>
  );
}

export function SeatPicker({
  count,
  occupied,
  names = [],
  seat,
  onClaim,
  onRelease,
}: {
  count: number;
  occupied: boolean[];
  names?: (string | null)[];
  seat: number | null;
  onClaim: (seat: number) => void;
  onRelease: () => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 lg:min-w-80">
      {Array.from({ length: count }, (_unused, i) => {
        const taken = occupied[i] ?? false;
        const mine = seat === i;
        const playerName = names[i] ?? null;
        const sublabel = mine
          ? "(you)"
          : (playerName ?? (taken ? "(taken)" : null));
        return (
          <button
            key={i}
            type="button"
            disabled={taken && !mine}
            onClick={() => {
              if (mine) onRelease();
              else onClaim(i);
            }}
            className={cx(
              "min-h-12 rounded-md border px-2 text-sm font-black transition",
              mine &&
                "border-emerald-300 bg-emerald-400 text-zinc-950 shadow-lg shadow-emerald-500/20",
              taken &&
                !mine &&
                "cursor-not-allowed border-zinc-800 bg-zinc-900 text-zinc-600",
              !taken &&
                !mine &&
                "border-zinc-700 bg-zinc-800 text-zinc-100 hover:border-red-300 hover:bg-red-400 hover:text-zinc-950",
            )}
          >
            <span>P{i + 1}</span>
            {sublabel !== null && (
              <span className="block truncate text-xs font-normal opacity-75">
                {sublabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ControlCluster({
  title,
  children,
  className,
  showTitle = true,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  showTitle?: boolean;
}) {
  return (
    <section className={cx("space-y-2", className)}>
      <h2
        className={cx(
          "text-[11px] font-black uppercase tracking-[0.2em] text-zinc-700",
          !showTitle && "sr-only",
        )}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function DpadControls({
  controls,
  pressedCodes,
  onPress,
  onRelease,
  variant = "dpad",
  className,
}: {
  controls: ControlDefinition[];
  pressedCodes: Set<string>;
  onPress: (code: string) => void;
  onRelease: (code: string) => void;
  variant?: "dpad" | "c";
  className?: string;
}) {
  const [up, left, right, down] = controls;
  if (variant === "dpad") {
    const buttons = [
      { control: up, className: "left-1/2 top-0 -translate-x-1/2" },
      { control: left, className: "left-0 top-1/2 -translate-y-1/2" },
      { control: right, className: "right-0 top-1/2 -translate-y-1/2" },
      { control: down, className: "bottom-0 left-1/2 -translate-x-1/2" },
    ];
    return (
      <div className={cx("relative h-24 w-24 sm:h-28 sm:w-28", className)}>
        <div className="absolute left-1/2 top-1/2 h-full w-7 -translate-x-1/2 -translate-y-1/2 rounded-md border border-zinc-950 bg-gradient-to-b from-zinc-500 via-zinc-800 to-zinc-950 shadow-[inset_0_2px_2px_rgba(255,255,255,0.12),0_5px_10px_rgba(0,0,0,0.45)] sm:w-8" />
        <div className="absolute left-1/2 top-1/2 h-7 w-full -translate-x-1/2 -translate-y-1/2 rounded-md border border-zinc-950 bg-gradient-to-br from-zinc-500 via-zinc-800 to-zinc-950 shadow-[inset_0_2px_2px_rgba(255,255,255,0.12),0_5px_10px_rgba(0,0,0,0.45)] sm:h-8" />
        <div className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-zinc-900 sm:h-8 sm:w-8" />
        {buttons.map(({ control, className: buttonClassName }) => (
          <button
            key={control.code}
            type="button"
            aria-label={`${control.label} ${control.sublabel}`}
            aria-pressed={isControlPressed(control, pressedCodes)}
            onPointerDown={() => {
              onPress(control.code);
            }}
            onPointerUp={() => {
              onRelease(control.code);
            }}
            onPointerCancel={() => {
              onRelease(control.code);
            }}
            onPointerLeave={() => {
              onRelease(control.code);
            }}
            className={cx(
              "absolute z-20 flex h-8 w-8 touch-none items-center justify-center rounded-md text-lg font-black text-white transition sm:h-10 sm:w-10",
              isControlPressed(control, pressedCodes) &&
                "bg-white text-zinc-950 shadow-[0_0_18px_rgba(255,255,255,0.45)]",
              buttonClassName,
            )}
          >
            {control.label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className={cx("relative h-36 w-36", className)}>
      <ControlButton
        control={up}
        pressed={isControlPressed(up, pressedCodes)}
        onPress={onPress}
        onRelease={onRelease}
        variant={variant}
        className="absolute left-1/2 top-0 h-11 w-11 -translate-x-1/2 sm:h-12 sm:w-12"
      />
      <ControlButton
        control={left}
        pressed={isControlPressed(left, pressedCodes)}
        onPress={onPress}
        onRelease={onRelease}
        variant={variant}
        className="absolute left-0 top-1/2 h-11 w-11 -translate-y-1/2 sm:h-12 sm:w-12"
      />
      <ControlButton
        control={right}
        pressed={isControlPressed(right, pressedCodes)}
        onPress={onPress}
        onRelease={onRelease}
        variant={variant}
        className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2 sm:h-12 sm:w-12"
      />
      <ControlButton
        control={down}
        pressed={isControlPressed(down, pressedCodes)}
        onPress={onPress}
        onRelease={onRelease}
        variant={variant}
        className="absolute bottom-0 left-1/2 h-11 w-11 -translate-x-1/2 sm:h-12 sm:w-12"
      />
    </div>
  );
}

export function ControlButton({
  control,
  pressed,
  onPress,
  onRelease,
  variant,
  className,
  labelClassName,
}: {
  control: ControlDefinition;
  pressed: boolean;
  onPress: (code: string) => void;
  onRelease: (code: string) => void;
  variant: ControlVariant;
  className?: string;
  labelClassName?: string;
}) {
  const base =
    "flex select-none touch-none flex-col items-center justify-center border text-center transition active:translate-y-0.5";
  const idle = {
    dpad: "border-zinc-950 bg-gradient-to-br from-zinc-500 via-zinc-700 to-zinc-900 text-zinc-50 shadow-[inset_0_2px_2px_rgba(255,255,255,0.12),0_6px_12px_rgba(0,0,0,0.4)] hover:from-zinc-400",
    faceA:
      "border-sky-900 bg-gradient-to-br from-sky-200 via-sky-500 to-sky-800 text-white shadow-[inset_0_2px_2px_rgba(255,255,255,0.35),0_4px_0_rgb(7,89,133),0_8px_12px_rgba(0,0,0,0.28)] hover:from-sky-100",
    faceB:
      "border-emerald-900 bg-gradient-to-br from-emerald-200 via-emerald-500 to-emerald-800 text-white shadow-[inset_0_2px_2px_rgba(255,255,255,0.35),0_4px_0_rgb(6,95,70),0_8px_12px_rgba(0,0,0,0.28)] hover:from-emerald-100",
    c: "border-yellow-800 bg-gradient-to-br from-yellow-100 via-yellow-400 to-yellow-700 text-zinc-950 shadow-[inset_0_2px_2px_rgba(255,255,255,0.45),0_4px_0_rgb(161,98,7),0_8px_12px_rgba(0,0,0,0.28)] hover:from-yellow-50",
    shoulder:
      "border-zinc-950 bg-gradient-to-br from-zinc-300 via-zinc-500 to-zinc-800 text-white shadow-[inset_0_2px_2px_rgba(255,255,255,0.22),0_4px_0_rgb(39,39,42),0_8px_12px_rgba(0,0,0,0.35)] hover:from-zinc-200",
    start:
      "border-red-950 bg-gradient-to-br from-red-200 via-red-500 to-red-800 text-white shadow-[inset_0_2px_2px_rgba(255,255,255,0.35),0_3px_0_rgb(127,29,29),0_7px_10px_rgba(0,0,0,0.32)] hover:from-red-100",
    z: "border-zinc-950 bg-gradient-to-br from-zinc-400 via-zinc-700 to-zinc-950 text-white shadow-[inset_0_2px_2px_rgba(255,255,255,0.14),0_5px_0_rgb(24,24,27),0_9px_14px_rgba(0,0,0,0.38)] hover:from-zinc-300",
  }[variant];
  const shape = {
    dpad: "rounded-lg px-2 py-2",
    faceA: "h-12 w-12 rounded-full px-2 py-2 sm:h-14 sm:w-14",
    faceB: "h-11 w-11 rounded-full px-2 py-2 sm:h-12 sm:w-12",
    c: "rounded-full px-2 py-2",
    shoulder: "min-h-8 rounded-t-2xl rounded-b-md px-4 py-1 sm:min-h-9",
    start: "h-12 w-12 rounded-full px-1 py-1 sm:h-14 sm:w-14",
    z: "min-h-8 rounded-[0.85rem] px-4 py-1 sm:min-h-9",
  }[variant];
  return (
    <button
      type="button"
      aria-label={`${control.label} ${control.sublabel}`}
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
        base,
        shape,
        pressed
          ? "border-white bg-white text-zinc-950 shadow-[0_0_24px_rgba(255,255,255,0.55)]"
          : idle,
        className,
      )}
    >
      <span
        className={cx(
          "text-lg font-black leading-none drop-shadow-sm sm:text-xl",
          variant === "c" && "text-base sm:text-lg",
          variant === "shoulder" && "text-lg sm:text-xl",
          variant === "start" && "text-[10px] uppercase sm:text-xs",
          variant === "z" && "text-base sm:text-lg",
          labelClassName,
        )}
      >
        {control.label}
      </span>
      <span className="mt-0.5 text-[8px] font-black uppercase tracking-[0.06em] opacity-75">
        {control.sublabel}
      </span>
    </button>
  );
}

export function InputPill({ label }: { label: string }) {
  return (
    <span className="rounded bg-white px-2 py-1 text-xs font-black text-zinc-950">
      {label}
    </span>
  );
}

export function MappingTerm({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <>
      <dt className="font-semibold text-zinc-500">{label}</dt>
      <dd className="font-semibold text-zinc-200">{value}</dd>
    </>
  );
}
