// Gamepad API support: a pure mapping from the browser's "standard" layout to
// N64 controls, plus a hook that polls connected pads once per animation frame.
//
// Standard layout indices (W3C Gamepad, "standard" mapping):
//   0 bottom face (Xbox A / Switch B)   1 right face (Xbox B / Switch A)
//   2 left face (Xbox X / Switch Y)     3 top face (Xbox Y / Switch X)
//   4 LB  5 RB  6 LT  7 RT  8 Back  9 Start  10/11 stick clicks
//   12 D-up 13 D-down 14 D-left 15 D-right
//   axes: 0/1 left stick x/y, 2/3 right stick x/y (y grows downward)
import { useEffect, useRef, useState } from "react";
import {
  EMPTY_BUTTONS,
  type ButtonState,
} from "@discord-plays-mario-kart/common";
import {
  CENTERED,
  GAMEPAD_DEADZONE,
  applyRadialDeadzone,
  sameButtons,
  type StickVector,
} from "./analog.ts";

/** Right-stick deflection that counts as a C-button press. */
export const C_STICK_THRESHOLD = 0.5;
/** Analog trigger travel that counts as a press, for pads that report value only. */
const TRIGGER_THRESHOLD = 0.4;

export type GamepadSnapshot = {
  readonly buttons: readonly {
    readonly pressed: boolean;
    readonly value: number;
  }[];
  readonly axes: readonly number[];
};

export type GamepadInput = {
  readonly buttons: ButtonState;
  readonly analog: StickVector;
};

export const NEUTRAL_GAMEPAD: GamepadInput = {
  buttons: EMPTY_BUTTONS,
  analog: CENTERED,
};

/** Which N64 button each standard-layout button index drives. */
const BUTTON_MAP: readonly (readonly [number, keyof ButtonState])[] = [
  [0, "a"],
  [1, "b"],
  [2, "b"],
  [4, "l"],
  [5, "r"],
  [6, "z"],
  [7, "r"],
  [9, "start"],
  [12, "up"],
  [13, "down"],
  [14, "left"],
  [15, "right"],
];

function isPressed(pad: GamepadSnapshot, index: number): boolean {
  const button = pad.buttons.find((_, i) => i === index);
  return (
    button !== undefined && (button.pressed || button.value > TRIGGER_THRESHOLD)
  );
}

/** Map one standard-layout gamepad reading to N64 buttons and stick. */
export function mapStandardGamepad(pad: GamepadSnapshot): GamepadInput {
  const buttons: ButtonState = { ...EMPTY_BUTTONS };
  for (const [index, name] of BUTTON_MAP) {
    if (isPressed(pad, index)) {
      buttons[name] = true;
    }
  }
  const rightX = pad.axes[2] ?? 0;
  const rightY = pad.axes[3] ?? 0;
  if (rightY <= -C_STICK_THRESHOLD) {
    buttons.cUp = true;
  }
  if (rightY >= C_STICK_THRESHOLD) {
    buttons.cDown = true;
  }
  if (rightX <= -C_STICK_THRESHOLD) {
    buttons.cLeft = true;
  }
  if (rightX >= C_STICK_THRESHOLD) {
    buttons.cRight = true;
  }
  const analog = applyRadialDeadzone(
    { x: pad.axes[0] ?? 0, y: -(pad.axes[1] ?? 0) },
    GAMEPAD_DEADZONE,
  );
  return { buttons, analog };
}

function sameGamepadInput(a: GamepadInput, b: GamepadInput): boolean {
  return (
    a.analog.x === b.analog.x &&
    a.analog.y === b.analog.y &&
    sameButtons(a.buttons, b.buttons)
  );
}

function firstGamepad(): Gamepad | undefined {
  return typeof navigator.getGamepads === "function"
    ? (navigator.getGamepads().find((pad) => pad?.connected === true) ??
        undefined)
    : undefined;
}

/**
 * Poll the first connected gamepad every animation frame and report mapped
 * input on change only. Returns the pad's id while one is connected.
 */
export function useGamepad(
  onChange: (input: GamepadInput) => void,
): string | undefined {
  const [connected, setConnected] = useState<string>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let frame: number | undefined;
    let last = NEUTRAL_GAMEPAD;

    const poll = () => {
      const pad = firstGamepad();
      if (pad === undefined) {
        frame = undefined;
        setConnected(undefined);
        if (!sameGamepadInput(last, NEUTRAL_GAMEPAD)) {
          last = NEUTRAL_GAMEPAD;
          onChangeRef.current(NEUTRAL_GAMEPAD);
        }
        return;
      }
      setConnected(pad.id);
      const next = mapStandardGamepad(pad);
      if (!sameGamepadInput(last, next)) {
        last = next;
        onChangeRef.current(next);
      }
      frame = requestAnimationFrame(poll);
    };
    const start = () => {
      frame ??= requestAnimationFrame(poll);
    };

    globalThis.addEventListener("gamepadconnected", start);
    // Some browsers only expose a pad already plugged in after a button press,
    // which fires gamepadconnected; others list it immediately.
    if (firstGamepad() !== undefined) {
      start();
    }
    return () => {
      globalThis.removeEventListener("gamepadconnected", start);
      if (frame !== undefined) {
        cancelAnimationFrame(frame);
      }
    };
  }, []);

  return connected;
}
