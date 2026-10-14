import type { ControllerState } from "@arcade/common/protocol.ts";

type Button = ControllerState["buttons"][number];
const directions = new Set<Button>(["up", "down", "left", "right"]);
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** Keyboard movement steers; the touch D-pad remains a separate digital pad. */
export function mergeControls(
  pad: ControllerState,
  touch: ControllerState,
  keys: ReadonlySet<Button>,
): ControllerState {
  const axis = (
    positive: Button,
    negative: Button,
    physical: number,
    screen: number,
  ) =>
    clamp(
      Number(keys.has(positive)) -
        Number(keys.has(negative)) +
        physical +
        screen,
    );
  return {
    buttons: [
      ...new Set([
        ...pad.buttons,
        ...touch.buttons,
        ...[...keys].filter((button) => !directions.has(button)),
      ]),
    ],
    stickX: axis("right", "left", pad.stickX, touch.stickX),
    stickY: axis("up", "down", pad.stickY, touch.stickY),
    cStickX: axis("c-right", "c-left", pad.cStickX, touch.cStickX),
    cStickY: axis("c-up", "c-down", pad.cStickY, touch.cStickY),
    triggerL: keys.has("l") ? 1 : Math.max(pad.triggerL, touch.triggerL),
    triggerR: keys.has("r") ? 1 : Math.max(pad.triggerR, touch.triggerR),
  };
}
