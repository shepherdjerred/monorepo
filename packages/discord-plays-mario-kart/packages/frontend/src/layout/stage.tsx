import IconBroadcast from "~icons/ph/broadcast-fill";
import IconRotate from "~icons/ph/device-rotate-fill";
import { Kerb } from "#src/ui/mk.tsx";

/**
 * A start line under a blue sky, drawn in CSS: sky, rolling hills, mown grass,
 * and the asphalt with its kerbs and checkered finish line running away to the
 * horizon.
 */
function TrackScene() {
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {/* Sky */}
      <div className="absolute inset-x-0 top-0 h-[52%] bg-[linear-gradient(180deg,#1d5fd0_0%,#4aa3f0_60%,#9fd8ff_100%)]" />
      {/* Clouds */}
      <div className="absolute top-[12%] left-[14%] h-[9%] w-[16%] rounded-full bg-white/80 blur-[1px]" />
      <div className="absolute top-[8%] left-[20%] h-[10%] w-[9%] rounded-full bg-white/85 blur-[1px]" />
      <div className="absolute top-[18%] right-[16%] h-[8%] w-[14%] rounded-full bg-white/70 blur-[1px]" />
      <div className="absolute top-[14%] right-[21%] h-[9%] w-[7%] rounded-full bg-white/75 blur-[1px]" />
      {/* Hills */}
      <div className="absolute top-[38%] -left-[10%] h-[30%] w-[60%] rounded-[50%] bg-[#2f8a34]" />
      <div className="absolute top-[34%] right-[-8%] h-[34%] w-[55%] rounded-[50%] bg-[#276f2c]" />
      {/* Grass, mown in bands */}
      <div className="absolute inset-x-0 bottom-0 h-[50%] bg-[repeating-linear-gradient(180deg,#3e9c3a_0_14px,#46a842_14px_28px)]" />
      {/* Road, receding to the horizon */}
      <div
        className="absolute inset-x-0 bottom-0 h-[50%] bg-[linear-gradient(180deg,#4a4f5e,#363a46)]"
        style={{ clipPath: "polygon(44% 0, 56% 0, 96% 100%, 4% 100%)" }}
      />
      {/* Kerbs along both edges */}
      <div
        className="mk-kerb absolute inset-x-0 bottom-0 h-[50%]"
        style={{ clipPath: "polygon(43.3% 0, 44% 0, 4% 100%, 0.5% 100%)" }}
      />
      <div
        className="mk-kerb absolute inset-x-0 bottom-0 h-[50%]"
        style={{ clipPath: "polygon(56% 0, 56.7% 0, 99.5% 100%, 96% 100%)" }}
      />
      {/* Centre dashes */}
      <div
        className="absolute bottom-0 left-1/2 h-[50%] w-[1.4%] -translate-x-1/2 bg-[repeating-linear-gradient(180deg,#f4f6ff_0_10px,transparent_10px_24px)] opacity-80"
        style={{ clipPath: "polygon(40% 0, 60% 0, 100% 100%, 0 100%)" }}
      />
      {/* Finish line */}
      <div
        className="mk-checker absolute inset-x-0 bottom-[14%] h-[7%] opacity-95"
        style={{ clipPath: "polygon(10.5% 0, 89.5% 0, 91% 100%, 9% 100%)" }}
      />
      {/* Readability: darken toward the centre where the message sits */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(8_12_31/0.55)_0%,rgb(8_12_31/0.15)_70%)]" />
    </div>
  );
}

/**
 * Stands in for the live feed when this browser is not driving: the picture is
 * only sent to seated drivers, and everyone else watches the Go-Live stream.
 */
export function Stage({ message }: { message: string }) {
  return (
    <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-2xl border-2 border-[#0b1130] shadow-card sm:aspect-[21/9] xl:aspect-[3/1]">
      <TrackScene />
      <div className="relative mx-4 flex max-w-md flex-col items-center gap-2 rounded-2xl border border-white/15 bg-[#0b1130]/80 px-6 py-5 text-center shadow-[0_18px_40px_-12px_rgb(0_0_0/0.7)] backdrop-blur-md">
        <span className="flex size-11 -skew-x-6 items-center justify-center rounded-xl bg-[linear-gradient(180deg,#ff3448,#b80d21)] text-2xl text-mk-yellow shadow-[0_3px_0_#6e0712]">
          <IconBroadcast />
        </span>
        <p className="mk-title text-2xl leading-tight text-white">{message}</p>
        <p className="text-xs leading-relaxed text-ink-muted">
          Drivers get a low-latency feed right here. Spectators watch the
          Go-Live stream in the Discord voice channel.
        </p>
      </div>
    </div>
  );
}

export function RotateHint() {
  return (
    <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl border border-mk-yellow/40 bg-[linear-gradient(90deg,rgb(255_210_31/0.16),rgb(255_210_31/0.04))] py-3 pr-4 pl-5">
      <Kerb className="absolute inset-y-0 left-0 w-1.5 rounded-none" />
      <IconRotate className="size-7 shrink-0 text-mk-yellow" />
      <div>
        <p className="mk-title text-lg leading-tight text-white">
          Turn your phone sideways
        </p>
        <p className="text-xs text-ink-muted">
          Landscape opens the full touch controller around the feed. A Bluetooth
          gamepad works too.
        </p>
      </div>
    </div>
  );
}
