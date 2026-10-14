import { wire } from "@arcade/common/wire.generated.ts";
import {
  ControllerSchema,
  type ControllerState,
} from "@arcade/common/protocol.ts";

export type CubePad = {
  seat: number;
  buttons: number;
  stickX: number;
  stickY: number;
  cStickX: number;
  cStickY: number;
  triggerL: number;
  triggerR: number;
  clear: boolean;
};

export function encodeInput(
  seat: number,
  state: ControllerState,
  clear = false,
): Uint8Array {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3)
    throw new Error("Invalid controller port");
  ControllerSchema.parse(state);
  const held = new Set<string>(state.buttons);
  if (state.triggerL >= 0.95) held.add("l");
  if (state.triggerR >= 0.95) held.add("r");
  const pad: CubePad = {
    seat,
    buttons: Object.entries(wire.padButtons).reduce(
      (mask, [name, bit]) => (held.has(name) ? mask | bit : mask),
      0,
    ),
    stickX: Math.round(state.stickX * 127),
    stickY: Math.round(state.stickY * 127),
    cStickX: Math.round(state.cStickX * 127),
    cStickY: Math.round(state.cStickY * 127),
    triggerL: Math.round(state.triggerL * 255),
    triggerR: Math.round(state.triggerR * 255),
    clear,
  };
  const bytes = new Uint8Array(wire.input.bytes);
  const view = new DataView(bytes.buffer);
  view.setInt32(wire.input.seat, pad.seat, true);
  view.setInt32(wire.input.buttons, pad.buttons, true);
  view.setInt32(wire.input.stickX, pad.stickX, true);
  view.setInt32(wire.input.stickY, pad.stickY, true);
  view.setInt32(wire.input.cStickX, pad.cStickX, true);
  view.setInt32(wire.input.cStickY, pad.cStickY, true);
  view.setInt32(wire.input.triggerL, pad.triggerL, true);
  view.setInt32(wire.input.triggerR, pad.triggerR, true);
  view.setInt32(wire.input.clear, Number(clear), true);
  decodeInput(bytes);
  return bytes;
}

export function decodeInput(bytes: Uint8Array): CubePad {
  if (bytes.length !== wire.input.bytes)
    throw new Error("Invalid controller packet size");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pad = {
    seat: view.getInt32(wire.input.seat, true),
    buttons: view.getInt32(wire.input.buttons, true),
    stickX: view.getInt32(wire.input.stickX, true),
    stickY: view.getInt32(wire.input.stickY, true),
    cStickX: view.getInt32(wire.input.cStickX, true),
    cStickY: view.getInt32(wire.input.cStickY, true),
    triggerL: view.getInt32(wire.input.triggerL, true),
    triggerR: view.getInt32(wire.input.triggerR, true),
  };
  if (pad.seat < 0 || pad.seat > 3) throw new Error("Invalid controller port");
  const allowed = Object.values(wire.padButtons).reduce(
    (mask, bit) => mask | bit,
    0,
  );
  if ((pad.buttons & ~allowed) !== 0)
    throw new Error("Invalid GameCube button mask");
  if (
    [pad.stickX, pad.stickY, pad.cStickX, pad.cStickY].some(
      (axis) => axis < -127 || axis > 127,
    )
  )
    throw new Error("Invalid controller stick");
  if (
    [pad.triggerL, pad.triggerR].some((trigger) => trigger < 0 || trigger > 255)
  )
    throw new Error("Invalid controller trigger");
  const clear = view.getInt32(wire.input.clear, true);
  if (clear !== 0 && clear !== 1) throw new Error("Invalid controller reset");
  return { ...pad, clear: clear === 1 };
}
