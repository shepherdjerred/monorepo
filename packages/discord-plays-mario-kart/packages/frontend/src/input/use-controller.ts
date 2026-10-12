// One controller per page: keyboard keys, on-screen buttons, the touch stick,
// and a gamepad all feed the same merged PlayerInputState, which is emitted to
// the server on every genuine change while this browser holds a seat.
//
// Edges are sent immediately rather than coalesced: the backend keeps only the
// latest state per seat before each game tick, and a coalescing timer would add
// up to a frame of input latency for no useful rate reduction.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_INPUT,
  type InputRequest,
  type PlayerInputState,
} from "@discord-plays-mario-kart/common";
import { useKeyboardControls } from "@shepherdjerred/discord-plays-web/input/use-controls.ts";
import { socket } from "#src/socket.ts";
import { KEYMAP, computeState, resolveKeyboardCode } from "#src/input-map.ts";
import { CENTERED, mergeInput, sameInput, type StickVector } from "./analog.ts";
import { NEUTRAL_GAMEPAD, useGamepad, type GamepadInput } from "./gamepad.ts";

export type Controller = {
  /** Merged state, for lighting up the on-screen controls. */
  readonly state: PlayerInputState;
  /** Keyboard codes currently held (keyboard and on-screen buttons). */
  readonly pressedCodes: ReadonlySet<string>;
  readonly press: (code: string) => void;
  readonly release: (code: string) => void;
  readonly setStick: (vector: StickVector) => void;
  /** The connected gamepad's id, if any. */
  readonly gamepad: string | undefined;
};

export function useController(seat: number | null): Controller {
  const pressed = useRef(new Set<string>());
  const stick = useRef<StickVector>(CENTERED);
  const pad = useRef<GamepadInput>(NEUTRAL_GAMEPAD);
  const seatRef = useRef(seat);
  const lastSent = useRef<PlayerInputState>(EMPTY_INPUT);
  const [state, setState] = useState<PlayerInputState>(EMPTY_INPUT);
  const [pressedCodes, setPressedCodes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const update = useCallback(() => {
    const next = mergeInput(
      computeState(pressed.current),
      [stick.current, pad.current.analog],
      [pad.current.buttons],
    );
    setState(next);
    setPressedCodes(new Set(pressed.current));
    const current = seatRef.current;
    if (current === null || sameInput(next, lastSent.current)) {
      return;
    }
    lastSent.current = next;
    const request: InputRequest = { kind: "input", seat: current, state: next };
    socket.emit("request", request);
  }, []);

  // A new seat starts from neutral on the server, so the next change is sent
  // in full even if it matches what the previous seat last received.
  useEffect(() => {
    seatRef.current = seat;
    lastSent.current = EMPTY_INPUT;
    update();
  }, [seat, update]);

  const press = useCallback(
    (code: string) => {
      if (pressed.current.has(code)) {
        return;
      }
      pressed.current.add(code);
      update();
    },
    [update],
  );
  const release = useCallback(
    (code: string) => {
      if (!pressed.current.delete(code)) {
        return;
      }
      update();
    },
    [update],
  );
  const setStick = useCallback(
    (vector: StickVector) => {
      if (vector.x === stick.current.x && vector.y === stick.current.y) {
        return;
      }
      stick.current = vector;
      update();
    },
    [update],
  );

  const gamepad = useGamepad(
    useCallback(
      (input: GamepadInput) => {
        pad.current = input;
        update();
      },
      [update],
    ),
  );

  const releaseAll = useCallback(() => {
    if (pressed.current.size === 0) {
      return;
    }
    pressed.current.clear();
    update();
  }, [update]);

  useKeyboardControls({ press, release, releaseAll }, (event) => {
    const code = resolveKeyboardCode(event);
    return code === undefined || KEYMAP[code] === undefined ? undefined : code;
  });

  return { state, pressedCodes, press, release, setStick, gamepad };
}
