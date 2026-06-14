import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useInterval } from "react-use";
import { Container } from "./stories/container.tsx";
import { socket } from "./socket.ts";
import {
  type InputRequest,
  type LatencyReportRequest,
  type Response,
  type SeatClaimRequest,
  type SeatReleaseRequest,
} from "@discord-plays-mario-kart/common";
import {
  C_CONTROLS,
  DPAD_CONTROLS,
  FACE_CONTROLS,
  KEYMAP,
  SHOULDER_CONTROLS,
  STICK_X_CONTROLS,
  STICK_Y_CONTROLS,
  computeState,
  resolveKeyboardCode,
} from "./input-map.ts";
import {
  ControlButton,
  ControlCluster,
  DpadControls,
  InputPill,
  N64ControllerShell,
  SeatPicker,
  isControlPressed,
} from "./controller-ui.tsx";
import { AnalogStick } from "./analog-stick.tsx";
import { NameEntry } from "./name-entry.tsx";
import { Leaderboard } from "./leaderboard.tsx";

const BUTTON_LABELS = [
  ["up", "D↑"],
  ["down", "D↓"],
  ["left", "D←"],
  ["right", "D→"],
  ["a", "A"],
  ["b", "B"],
  ["start", "Start"],
  ["z", "Z"],
  ["l", "L"],
  ["r", "R"],
  ["cUp", "C↑"],
  ["cDown", "C↓"],
  ["cLeft", "C←"],
  ["cRight", "C→"],
] as const;

// Action → on-controller → keyboard. Ordered by frequency of use in MK64 so the
// player sees the racing essentials first and the menu-only bindings last.
const MAPPING_ROWS: readonly [string, string, string][] = [
  ["Steer", "Stick X", "A / D"],
  ["Accelerate", "A", "W / Space"],
  ["Brake / Reverse", "B", "S"],
  ["Hop / Drift", "R trigger", "Shift"],
  ["Use item", "Z trigger", "E / Z"],
  ["Pause / Confirm", "Start", "Enter / P"],
  ["Menus", "D-pad", "Arrow keys"],
  ["Camera angles", "C-buttons", "I J K L"],
  ["Camera reset", "L trigger", "Q"],
  ["Menu nav (vertical)", "Stick Y", "R / F"],
];

// True when the keyboard event is targeted at a form control / contentEditable
// region. Global key handlers must not preventDefault in that case, or typing
// in the name input swallows any character that's also a KEYMAP binding.
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function App() {
  const [seat, setSeat] = useState<number | null>(null);
  const [occupied, setOccupied] = useState<boolean[]>([]);
  const [names, setNames] = useState<(string | null)[]>([]);
  const [latency, setLatency] = useState<number>();
  const pressed = useRef<Set<string>>(new Set());
  const [pressedCodes, setPressedCodes] = useState<Set<string>>(
    () => new Set(),
  );
  const seatRef = useRef<number | null>(null);
  seatRef.current = seat;

  useInterval(() => {
    const start = Date.now();
    socket.emit("ping", () => {
      const rtt = Date.now() - start;
      setLatency(rtt);
      // Report the measurement so the server can export it as a metric
      // (client-side timing avoids any clock-skew question).
      const report: LatencyReportRequest = {
        kind: "latency-report",
        rttMs: rtt,
      };
      socket.emit("request", report);
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
      setPressedCodes(new Set(pressed.current));
      emit();
    },
    [emit],
  );
  const release = useCallback(
    (code: string) => {
      if (!pressed.current.delete(code)) return;
      setPressedCodes(new Set(pressed.current));
      emit();
    },
    [emit],
  );
  const releaseAll = useCallback(() => {
    if (pressed.current.size === 0) return;
    pressed.current.clear();
    setPressedCodes(new Set());
    emit();
  }, [emit]);

  // Subscribe to server responses (seat assignment + occupancy).
  useEffect(() => {
    const onResponse = (response: Response) => {
      if (response.kind === "seat") {
        setSeat(response.value.seat);
      } else if (response.kind === "seats") {
        setOccupied(response.value.occupied);
        setNames(response.value.names);
      }
    };
    socket.on("response", onResponse);
    socket.emit("request", { kind: "status" });
    return () => {
      socket.off("response", onResponse);
    };
  }, []);

  // Keyboard control. When no seat is claimed the UI still previews pressed
  // state locally, but emit() is a no-op.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const code = resolveKeyboardCode(event);
      if (code === undefined || KEYMAP[code] === undefined) return;
      event.preventDefault();
      press(code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // No isEditableTarget guard here: releasing a key can never produce
      // unwanted typing, so we must always call release() to avoid a stuck-key
      // if the player presses a control key, clicks into a text field, and
      // releases while the field has focus.
      const code = resolveKeyboardCode(event);
      if (code === undefined || KEYMAP[code] === undefined) return;
      release(code);
    };
    const onBlur = () => {
      releaseAll();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("keyup", onKeyUp);
    globalThis.addEventListener("blur", onBlur);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup", onKeyUp);
      globalThis.removeEventListener("blur", onBlur);
      releaseAll();
    };
  }, [press, release, releaseAll]);

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
  const state = computeState(pressedCodes);
  const activeButtons = BUTTON_LABELS.filter(
    ([name]) => state.buttons[name],
  ).map(([_name, label]) => label);
  const hasSeat = seat !== null;
  const statusTone = hasSeat ? "text-emerald-300" : "text-amber-300";
  const [stickLeft, stickRight] = STICK_X_CONTROLS;
  const [stickUp, stickDown] = STICK_Y_CONTROLS;
  const [faceA, faceB, zControl, startControl] = FACE_CONTROLS;
  const [shoulderL, shoulderR] = SHOULDER_CONTROLS;

  const stickActive =
    state.analogX !== 0 || state.analogY !== 0 || activeButtons.length > 0;

  return (
    <div className="min-h-screen min-w-full bg-surface-page text-zinc-100">
      <Container>
        <main className="flex min-h-screen flex-col gap-5 px-4 py-5 sm:px-0 lg:py-6">
          <header className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-300">
                Discord Plays
              </p>
              <h1 className="text-2xl font-black leading-tight sm:text-3xl">
                Mario Kart 64 controller
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-400">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-2.5 py-0.5 font-semibold ${statusTone}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${hasSeat ? "bg-emerald-400" : "bg-amber-400"}`}
                  />
                  {hasSeat ? `Driving as P${String(seat + 1)}` : "Preview mode"}
                </span>
                {latency !== undefined && (
                  <span className="font-mono text-xs text-zinc-500">
                    {String(latency)}ms
                  </span>
                )}
              </div>
              {hasSeat && <NameEntry seat={seat} />}
            </div>
            <SeatPicker
              count={seatCount}
              occupied={occupied}
              names={names}
              seat={seat}
              onClaim={claim}
              onRelease={releaseSeat}
            />
          </header>

          <section className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-3 shadow-2xl shadow-black/40 sm:p-5">
              <div className="relative mx-auto aspect-[3/2] w-full">
                <N64ControllerShell />

                {/* Positions below are CENTER-based: left/top is the center
                    point and -translate-x-1/2 -translate-y-1/2 anchors there.
                    Coords mirror the SVG silhouette so each button lands in
                    its matching molded depression. */}

                <div className="absolute left-[24%] top-[12%] z-30 w-[15%] -translate-x-1/2 -translate-y-1/2">
                  <ControlButton
                    control={shoulderL}
                    pressed={isControlPressed(shoulderL, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="shoulder"
                    className="w-full"
                  />
                </div>
                <div className="absolute left-[76%] top-[12%] z-30 w-[15%] -translate-x-1/2 -translate-y-1/2">
                  <ControlButton
                    control={shoulderR}
                    pressed={isControlPressed(shoulderR, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="shoulder"
                    className="w-full"
                  />
                </div>

                <div className="absolute left-[23%] top-[49%] z-30 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5">
                  <DpadControls
                    controls={DPAD_CONTROLS}
                    pressedCodes={pressedCodes}
                    onPress={press}
                    onRelease={release}
                    className="h-24 w-24 sm:h-28 sm:w-28"
                  />
                  <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-zinc-300 shadow-sm">
                    Arrow keys
                  </span>
                </div>

                <div className="absolute left-1/2 top-[45%] z-30 -translate-x-1/2 -translate-y-1/2">
                  <ControlButton
                    control={startControl}
                    pressed={isControlPressed(startControl, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="start"
                  />
                </div>

                <ControlCluster
                  title="C-buttons"
                  className="absolute left-[83%] top-[45%] z-30 h-24 w-24 -translate-x-1/2 -translate-y-1/2 sm:h-28 sm:w-28"
                  showTitle={false}
                >
                  <DpadControls
                    controls={C_CONTROLS}
                    pressedCodes={pressedCodes}
                    onPress={press}
                    onRelease={release}
                    variant="c"
                    className="h-full w-full"
                  />
                </ControlCluster>

                <ControlCluster
                  title="A / B"
                  className="absolute left-[63%] top-[58%] z-30 h-20 w-24 -translate-x-1/2 -translate-y-1/2 sm:h-24 sm:w-28"
                  showTitle={false}
                >
                  <ControlButton
                    control={faceB}
                    pressed={isControlPressed(faceB, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="faceB"
                    className="absolute left-0 top-1 sm:top-2"
                  />
                  <ControlButton
                    control={faceA}
                    pressed={isControlPressed(faceA, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="faceA"
                    className="absolute right-0 top-10 sm:top-12"
                  />
                </ControlCluster>

                <div className="absolute left-1/2 top-[70%] z-30 -translate-x-1/2 -translate-y-1/2">
                  <AnalogStick
                    leftControl={stickLeft}
                    rightControl={stickRight}
                    upControl={stickUp}
                    downControl={stickDown}
                    axisX={state.analogX}
                    axisY={state.analogY}
                    pressedCodes={pressedCodes}
                    onPress={press}
                    onRelease={release}
                  />
                </div>

                <div className="absolute left-1/2 top-[94%] z-30 w-20 -translate-x-1/2 -translate-y-1/2 sm:w-24">
                  <ControlButton
                    control={zControl}
                    pressed={isControlPressed(zControl, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="z"
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4">
                <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-400">
                  Live input
                </h2>
                <div className="mt-3 flex min-h-10 flex-wrap gap-1.5">
                  {stickActive ? (
                    <>
                      {state.analogX < 0 ? <InputPill label="Stick ←" /> : null}
                      {state.analogX > 0 ? <InputPill label="Stick →" /> : null}
                      {state.analogY > 0 ? <InputPill label="Stick ↑" /> : null}
                      {state.analogY < 0 ? <InputPill label="Stick ↓" /> : null}
                      {activeButtons.map((label) => (
                        <InputPill key={label} label={label} />
                      ))}
                    </>
                  ) : (
                    <span className="text-sm text-zinc-600">
                      No keys pressed
                    </span>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4">
                <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-400">
                  Mapping
                </h2>
                <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 text-sm">
                  <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    Action
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    N64
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-zinc-500">
                    Keyboard
                  </div>
                  {MAPPING_ROWS.map(([action, n64, keys]) => (
                    <Fragment key={action}>
                      <span className="text-zinc-200">{action}</span>
                      <span className="text-zinc-500">{n64}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-right font-mono text-xs font-semibold text-zinc-100">
                        {keys}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                {hasSeat
                  ? "Your inputs are being sent to the game."
                  : "Claim a player slot when you are ready. Controls still light up here for testing."}
              </div>
              <Leaderboard />
            </aside>
          </section>
        </main>
      </Container>
    </div>
  );
}
