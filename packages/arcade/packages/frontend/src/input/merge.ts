import type { ControllerState } from "@arcade/common/protocol.ts";

const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const axis = (key: number, physical: number, screen: number) =>
  clamp(key + physical + screen);

/** Input translation belongs to each device; merging preserves digital pads. */
export function mergeControls(
  pad: ControllerState,
  touch: ControllerState,
  keyboard: ControllerState,
): ControllerState {
  return {
    buttons: [
      ...new Set([...pad.buttons, ...touch.buttons, ...keyboard.buttons]),
    ],
    stickX: axis(keyboard.stickX, pad.stickX, touch.stickX),
    stickY: axis(keyboard.stickY, pad.stickY, touch.stickY),
    cStickX: axis(keyboard.cStickX, pad.cStickX, touch.cStickX),
    cStickY: axis(keyboard.cStickY, pad.cStickY, touch.cStickY),
    triggerL: Math.max(keyboard.triggerL, pad.triggerL, touch.triggerL),
    triggerR: Math.max(keyboard.triggerR, pad.triggerR, touch.triggerR),
  };
}
