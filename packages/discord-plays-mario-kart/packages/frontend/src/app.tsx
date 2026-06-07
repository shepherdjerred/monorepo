import { useCallback, useEffect, useRef, useState } from "react";
import { useInterval } from "react-use";
import { Container } from "./stories/container.tsx";
import { socket } from "./socket.ts";
import {
  EMPTY_BUTTONS,
  type ButtonState,
  type InputRequest,
  type PlayerInputState,
  type Response,
  type SeatClaimRequest,
  type SeatReleaseRequest,
} from "@discord-plays-mario-kart/common";

// Web-key -> N64 control. Steering is analog (left/right); accelerate is the A
// button, brake/reverse is B, hop/drift is R, item is Z, camera is C-buttons.
type Action =
  | { kind: "button"; name: keyof ButtonState }
  | { kind: "axis"; axis: "x" | "y"; value: number };

const KEYMAP: Record<string, Action | undefined> = {
  KeyW: { kind: "button", name: "a" },
  ArrowUp: { kind: "button", name: "a" },
  KeyS: { kind: "button", name: "b" },
  ArrowDown: { kind: "button", name: "b" },
  KeyA: { kind: "axis", axis: "x", value: -1 },
  ArrowLeft: { kind: "axis", axis: "x", value: -1 },
  KeyD: { kind: "axis", axis: "x", value: 1 },
  ArrowRight: { kind: "axis", axis: "x", value: 1 },
  ShiftLeft: { kind: "button", name: "r" },
  ShiftRight: { kind: "button", name: "r" },
  KeyE: { kind: "button", name: "z" },
  Enter: { kind: "button", name: "start" },
  KeyI: { kind: "button", name: "cUp" },
  KeyK: { kind: "button", name: "cDown" },
  KeyJ: { kind: "button", name: "cLeft" },
  KeyL: { kind: "button", name: "cRight" },
};

// On-screen buttons (touch / click), each tied to a key code in KEYMAP.
const PADS: { code: string; label: string }[] = [
  { code: "KeyA", label: "◀ steer" },
  { code: "KeyW", label: "accel (A)" },
  { code: "KeyD", label: "steer ▶" },
  { code: "KeyS", label: "brake (B)" },
  { code: "ShiftLeft", label: "hop (R)" },
  { code: "KeyE", label: "item (Z)" },
  { code: "Enter", label: "start" },
];

function computeState(pressed: Set<string>): PlayerInputState {
  const buttons: ButtonState = { ...EMPTY_BUTTONS };
  let x = 0;
  let y = 0;
  for (const code of pressed) {
    const action = KEYMAP[code];
    if (action === undefined) continue;
    if (action.kind === "button") buttons[action.name] = true;
    else if (action.axis === "x") x += action.value;
    else y += action.value;
  }
  return {
    buttons,
    analogX: Math.max(-1, Math.min(1, x)),
    analogY: Math.max(-1, Math.min(1, y)),
  };
}

export function App() {
  const [seat, setSeat] = useState<number | null>(null);
  const [occupied, setOccupied] = useState<boolean[]>([]);
  const [latency, setLatency] = useState<number>();
  const pressed = useRef<Set<string>>(new Set());
  const seatRef = useRef<number | null>(null);
  seatRef.current = seat;

  useInterval(() => {
    const start = Date.now();
    socket.emit("ping", () => {
      setLatency(Date.now() - start);
    });
  }, 2000);

  const emit = useCallback(() => {
    const s = seatRef.current;
    if (s === null) return;
    const request: InputRequest = {
      kind: "input",
      seat: s,
      state: computeState(pressed.current),
    };
    socket.emit("request", request);
  }, []);

  const press = useCallback(
    (code: string) => {
      if (pressed.current.has(code)) return;
      pressed.current.add(code);
      emit();
    },
    [emit],
  );
  const release = useCallback(
    (code: string) => {
      if (!pressed.current.delete(code)) return;
      emit();
    },
    [emit],
  );

  // Subscribe to server responses (seat assignment + occupancy).
  useEffect(() => {
    const onResponse = (response: Response) => {
      if (response.kind === "seat") {
        setSeat(response.value.seat);
      } else if (response.kind === "seats") {
        setOccupied(response.value.occupied);
      }
    };
    socket.on("response", onResponse);
    socket.emit("request", { kind: "status" });
    return () => {
      socket.off("response", onResponse);
    };
  }, []);

  // Keyboard control (only while seated).
  useEffect(() => {
    if (seat === null) return;
    const pressedKeys = pressed.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (KEYMAP[event.code] === undefined) return;
      event.preventDefault();
      press(event.code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (KEYMAP[event.code] === undefined) return;
      event.preventDefault();
      release(event.code);
    };
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("keyup", onKeyUp);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      pressedKeys.clear();
      emit();
    };
  }, [seat, press, release, emit]);

  const claim = (requested?: number) => {
    const request: SeatClaimRequest = { kind: "seat-claim", seat: requested };
    socket.emit("request", request);
  };
  const releaseSeat = () => {
    const request: SeatReleaseRequest = { kind: "seat-release" };
    socket.emit("request", request);
    setSeat(null);
  };

  const seatCount = occupied.length || 4;

  return (
    <div className="bg-slate-900 text-slate-100 min-h-screen min-w-full">
      <Container>
        <div className="flex flex-col items-center gap-6 py-8">
          <h1 className="text-2xl font-bold">Discord Plays Mario Kart 64</h1>
          <p className="text-sm text-slate-400">
            Watch the live game in Discord (Go-Live). Claim a seat below to
            drive a kart. Latency:{" "}
            {latency === undefined ? "…" : `${String(latency)}ms`}
          </p>

          <div className="flex gap-3">
            {Array.from({ length: seatCount }, (_unused, i) => {
              const taken = occupied[i] ?? false;
              const mine = seat === i;
              return (
                <button
                  key={i}
                  disabled={taken && !mine}
                  onClick={() => {
                    if (mine) releaseSeat();
                    else claim(i);
                  }}
                  className={`px-4 py-2 rounded font-semibold ${
                    mine
                      ? "bg-emerald-600"
                      : taken
                        ? "bg-slate-700 opacity-50 cursor-not-allowed"
                        : "bg-slate-700 hover:bg-slate-600"
                  }`}
                >
                  P{i + 1}
                  {mine ? " (you)" : taken ? " (taken)" : ""}
                </button>
              );
            })}
          </div>

          {seat === null ? (
            <p className="text-slate-400">Claim a seat to start playing.</p>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <p className="text-emerald-400">
                You are P{seat + 1} — WASD / arrows, E = item, Shift = hop,
                Enter = start.
              </p>
              <div className="grid grid-cols-4 gap-2">
                {PADS.map((p) => (
                  <button
                    key={p.code}
                    onPointerDown={() => {
                      press(p.code);
                    }}
                    onPointerUp={() => {
                      release(p.code);
                    }}
                    onPointerLeave={() => {
                      release(p.code);
                    }}
                    className="px-3 py-3 rounded bg-slate-700 active:bg-emerald-600 select-none touch-none"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Container>
    </div>
  );
}
