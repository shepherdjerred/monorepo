import { Fragment } from "react";
import IconGamepad from "~icons/ph/game-controller-fill";
import IconKeyboard from "~icons/ph/keyboard-fill";
import type { Controller } from "#src/input/use-controller.ts";
import { Badge } from "#src/ui/badge.tsx";
import { Card, CardHeader } from "#src/ui/card.tsx";
import { Kbd } from "#src/ui/kbd.tsx";
import { ControlButton } from "./control-button.tsx";
import { DirectionPad } from "./direction-pad.tsx";
import { isCodeActive } from "./pressed.ts";
import { TouchStick } from "./touch-stick.tsx";

// Action → N64 control → keyboard. Racing essentials first, menu-only last.
const LEGEND: readonly (readonly [string, string, readonly string[]])[] = [
  ["Steer", "Stick", ["A", "D"]],
  ["Accelerate", "A", ["W", "Space"]],
  ["Brake", "B", ["S"]],
  ["Hop / drift", "R", ["Shift"]],
  ["Item", "Z", ["E"]],
  ["Pause", "Start", ["Enter"]],
  ["Menus", "D-pad", ["←", "↑", "↓", "→"]],
  ["Camera", "C", ["I", "J", "K", "L"]],
  ["Map toggle", "L", ["Q"]],
];

const DPAD = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
} as const;
const DPAD_HINTS = { up: "↑", down: "↓", left: "←", right: "→" } as const;
const C_PAD = {
  up: "KeyI",
  down: "KeyK",
  left: "KeyJ",
  right: "KeyL",
} as const;
const C_HINTS = { up: "I", down: "K", left: "J", right: "L" } as const;

/**
 * The controller panel for desktop: a flat N64 layout whose controls light up
 * for keyboard, mouse, and gamepad presses alike, plus the keyboard legend.
 */
export function DesktopController({
  controller,
  seated,
}: {
  controller: Controller;
  seated: boolean;
}) {
  const { state, press, release, setStick, gamepad } = controller;
  const button = (code: string) => ({
    code,
    active: isCodeActive(code, state),
    onPress: press,
    onRelease: release,
  });
  return (
    <Card role="region" aria-label="Controller">
      <CardHeader
        title="Controller"
        icon={<IconGamepad />}
        action={
          gamepad === undefined ? (
            <Badge icon={<IconKeyboard />}>Keyboard</Badge>
          ) : (
            <Badge tone="success" icon={<IconGamepad />}>
              Controller connected
            </Badge>
          )
        }
      />
      <div className="px-4 pb-4 sm:px-5">
        {seated ? null : (
          <p className="mb-3 rounded-lg border border-mk-yellow/25 bg-mk-yellow/[0.07] px-3 py-2 text-xs text-ink-muted">
            Preview only — controls light up, but nothing reaches the game until
            you take a seat.
          </p>
        )}
        <div className="relative mx-auto max-w-3xl overflow-hidden rounded-[40px] border border-black/40 bg-[radial-gradient(120%_90%_at_50%_0%,#a7adb8,#80868f_55%,#646a74)] px-6 pt-5 pb-6 shadow-[inset_0_2px_0_rgb(255_255_255/0.35),inset_0_-6px_14px_rgb(0_0_0/0.25),0_16px_30px_-12px_rgb(0_0_0/0.8)]">
          <div className="mb-4 flex items-center justify-between">
            <ControlButton
              {...button("KeyQ")}
              label="L"
              hint="Q"
              tone="z"
              shape="pill"
              className="h-9 w-28 text-sm"
            />
            <ControlButton
              {...button("ShiftLeft")}
              label="R"
              hint="Shift"
              tone="z"
              shape="pill"
              className="h-9 w-28 text-sm"
            />
          </div>
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-6">
            <DirectionPad
              codes={DPAD}
              hints={DPAD_HINTS}
              label="D-pad"
              state={state}
              onPress={press}
              onRelease={release}
              tone="neutral"
              variant="dpad"
              buttonSize={38}
            />
            <div className="flex flex-col items-center gap-4">
              <ControlButton
                {...button("Enter")}
                label="START"
                hint="Enter"
                tone="start"
                className="size-12 text-[9px] tracking-wider"
              />
              <TouchStick state={state} onStick={setStick} size={120} />
            </div>
            <div className="flex flex-col items-end gap-3">
              <DirectionPad
                codes={C_PAD}
                hints={C_HINTS}
                label="C buttons"
                state={state}
                onPress={press}
                onRelease={release}
                tone="c"
                variant="c"
                buttonSize={34}
              />
              <div className="relative h-[86px] w-[124px]">
                <ControlButton
                  {...button("KeyS")}
                  label="B"
                  hint="S"
                  tone="b"
                  className="absolute top-0 left-0 size-[52px] text-lg"
                />
                <ControlButton
                  {...button("KeyW")}
                  label="A"
                  hint="W or Space"
                  tone="a"
                  className="absolute right-0 bottom-0 size-[60px] text-xl"
                />
              </div>
            </div>
          </div>
          <div className="mt-5 flex justify-center">
            <ControlButton
              {...button("KeyE")}
              label="Z"
              hint="E"
              tone="z"
              shape="pill"
              className="h-9 w-24 text-sm"
            />
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
          {LEGEND.map(([action, n64, keys]) => (
            <Fragment key={action}>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-ink">
                  {action} <span className="text-ink-muted">· {n64}</span>
                </dt>
                <dd className="flex gap-1">
                  {keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </dd>
              </div>
            </Fragment>
          ))}
        </dl>
      </div>
    </Card>
  );
}
