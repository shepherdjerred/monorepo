import { useEffect, useState, type ReactNode } from "react";
import IconArrowsIn from "~icons/ph/arrows-in-bold";
import IconArrowsOut from "~icons/ph/arrows-out-bold";
import type { Controller } from "#src/input/use-controller.ts";
import { ControlButton } from "./control-button.tsx";
import { DirectionPad } from "./direction-pad.tsx";
import { isCodeActive } from "./pressed.ts";
import { TouchStick } from "./touch-stick.tsx";

const DPAD = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
} as const;
const C_PAD = {
  up: "KeyI",
  down: "KeyK",
  left: "KeyJ",
  right: "KeyL",
} as const;
const C_HINTS = {
  up: "C up",
  down: "C down",
  left: "C left",
  right: "C right",
};
const DPAD_HINTS = {
  up: "D-pad up",
  down: "D-pad down",
  left: "D-pad left",
  right: "D-pad right",
};

function useFullscreen(): {
  active: boolean;
  supported: boolean;
  toggle: () => void;
} {
  const [active, setActive] = useState(document.fullscreenElement !== null);
  useEffect(() => {
    const onChange = () => {
      setActive(document.fullscreenElement !== null);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);
  const supported =
    typeof document.documentElement.requestFullscreen === "function";
  const toggle = () => {
    if (document.fullscreenElement === null) {
      void document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } else {
      void document.exitFullscreen();
    }
  };
  return { active, supported, toggle };
}

/**
 * The phone controller, for landscape while seated: the feed in the middle,
 * stick and D-pad under the left thumb, A/B and the C diamond under the right,
 * triggers on the outer edges. Every target is at least 56 px.
 */
export function TouchController({
  controller,
  seat,
  feed,
  onLeave,
}: {
  controller: Controller;
  seat: number;
  feed: ReactNode;
  onLeave: () => void;
}) {
  const { state, press, release, setStick } = controller;
  const fullscreen = useFullscreen();
  const button = (code: string) => ({
    code,
    active: isCodeActive(code, state),
    onPress: press,
    onRelease: release,
  });

  return (
    <div className="no-touch-callout fixed inset-0 z-40 flex bg-[#050608] text-ink pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      {/* Left thumb */}
      <div className="flex w-[clamp(168px,24vw,260px)] shrink-0 flex-col items-center justify-between py-3">
        <div className="flex w-full items-center gap-2 px-3">
          <ControlButton
            {...button("KeyQ")}
            label="L"
            hint="L trigger"
            tone="z"
            shape="pill"
            className="h-11 flex-1 text-sm"
          />
          <ControlButton
            {...button("KeyE")}
            label="Z"
            hint="Z trigger (item)"
            tone="z"
            shape="pill"
            className="h-14 flex-[1.4] text-base"
          />
        </div>
        <TouchStick state={state} onStick={setStick} size={148} />
        <DirectionPad
          codes={DPAD}
          hints={DPAD_HINTS}
          label="D-pad"
          state={state}
          onPress={press}
          onRelease={release}
          tone="neutral"
          variant="dpad"
          buttonSize={40}
        />
      </div>

      {/* Feed */}
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2 py-2">
        <div className="flex w-full items-center justify-between px-1 text-[11px] text-ink-faint">
          <span className="rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-red-200">
            P{seat + 1}
          </span>
          <ControlButton
            {...button("Enter")}
            label="START"
            hint="Start"
            tone="start"
            shape="pill"
            className="h-7 w-20 text-[10px] tracking-wider"
          />
          <div className="flex items-center gap-1">
            {fullscreen.supported ? (
              <button
                type="button"
                aria-label={
                  fullscreen.active ? "Exit fullscreen" : "Fullscreen"
                }
                className="inline-flex size-7 items-center justify-center rounded-full bg-white/5 text-ink-muted"
                onClick={fullscreen.toggle}
              >
                {fullscreen.active ? <IconArrowsIn /> : <IconArrowsOut />}
              </button>
            ) : null}
            <button
              type="button"
              className="h-7 rounded-full bg-white/5 px-2.5 font-semibold text-ink-muted"
              onClick={onLeave}
            >
              Leave
            </button>
          </div>
        </div>
        <div className="flex min-h-0 w-full flex-1 items-center justify-center">
          {feed}
        </div>
      </div>

      {/* Right thumb */}
      <div className="flex w-[clamp(168px,24vw,260px)] shrink-0 flex-col items-center justify-between py-3">
        <div className="flex w-full px-3">
          <ControlButton
            {...button("ShiftLeft")}
            label="R"
            hint="R trigger (hop)"
            tone="z"
            shape="pill"
            className="h-14 w-full text-base"
          />
        </div>
        <DirectionPad
          codes={C_PAD}
          hints={C_HINTS}
          label="C buttons"
          state={state}
          onPress={press}
          onRelease={release}
          tone="c"
          variant="c"
          buttonSize={44}
        />
        <div className="relative h-[132px] w-[150px]">
          <ControlButton
            {...button("KeyS")}
            label="B"
            hint="B (brake)"
            tone="b"
            className="absolute top-0 left-0 size-16 text-xl"
          />
          <ControlButton
            {...button("KeyW")}
            label="A"
            hint="A (accelerate)"
            tone="a"
            className="absolute right-0 bottom-0 size-[76px] text-2xl"
          />
        </div>
      </div>
    </div>
  );
}
