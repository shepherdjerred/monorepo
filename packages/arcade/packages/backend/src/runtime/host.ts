import type { ControllerState } from "@arcade/common/protocol.ts";

export type RuntimeHost = {
  start: (signal: AbortSignal) => Promise<void>;
  stop: () => Promise<void>;
  input: (seat: number, state: ControllerState) => void;
  clearInput: (seat: number) => void;
};
