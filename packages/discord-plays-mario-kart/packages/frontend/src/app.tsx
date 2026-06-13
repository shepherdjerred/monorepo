import { useCallback, useEffect, useRef, useState } from "react";
import { useInterval } from "react-use";
import { Container } from "./stories/container.tsx";
import { socket } from "./socket.ts";
import {
  AnalogStick,
  ControlButton,
  ControlCluster,
  DpadControls,
  InputPill,
  MappingTerm,
  N64ControllerShell,
  SeatPicker,
  isControlPressed,
} from "./controller-ui.tsx";
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
  STICK_CONTROLS,
  computeState,
  resolveKeyboardCode,
} from "./input-map.ts";

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

export function App() {
  const [seat, setSeat] = useState<number | null>(null);
  const [occupied, setOccupied] = useState<boolean[]>([]);
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
      const code = resolveKeyboardCode(event);
      if (code === undefined || KEYMAP[code] === undefined) return;
      event.preventDefault();
      press(code);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const code = resolveKeyboardCode(event);
      if (code === undefined || KEYMAP[code] === undefined) return;
      event.preventDefault();
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
  const [stickLeft, stickRight] = STICK_CONTROLS;
  const [faceA, faceB, zControl, startControl] = FACE_CONTROLS;
  const [shoulderL, shoulderR] = SHOULDER_CONTROLS;

  return (
    <div className="min-h-screen min-w-full bg-[#070709] text-zinc-100">
      <Container>
        <main className="flex min-h-screen flex-col gap-5 px-4 py-5 sm:px-0 lg:py-4">
          <header className="flex flex-col gap-4 border-b border-zinc-800 pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-300">
                Discord Plays
              </p>
              <h1 className="text-2xl font-black leading-tight sm:text-3xl">
                Mario Kart 64 controller
              </h1>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-400">
                <span className={statusTone}>
                  {hasSeat ? `Driving as P${String(seat + 1)}` : "Preview mode"}
                </span>
                <span>
                  Latency{" "}
                  {latency === undefined ? "..." : `${String(latency)}ms`}
                </span>
              </div>
            </div>
            <SeatPicker
              count={seatCount}
              occupied={occupied}
              seat={seat}
              onClaim={claim}
              onRelease={releaseSeat}
            />
          </header>

          <section className="grid gap-4 xl:grid-cols-[1fr_280px]">
            <div className="overflow-hidden rounded-[2rem] border border-zinc-800 bg-zinc-950/80 p-3 shadow-2xl shadow-black/40 sm:p-5">
              <div className="relative mx-auto h-[650px] max-w-[880px] sm:h-[560px] lg:h-[460px]">
                <N64ControllerShell />

                <div className="absolute left-[13%] right-[13%] top-[25%] z-20 grid grid-cols-2 gap-[48%]">
                  <ControlButton
                    control={shoulderL}
                    pressed={isControlPressed(shoulderL, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="shoulder"
                    className="w-full"
                  />
                  <ControlButton
                    control={shoulderR}
                    pressed={isControlPressed(shoulderR, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="shoulder"
                    className="w-full"
                  />
                </div>

                <ControlCluster
                  title="D-pad"
                  className="absolute left-[18%] top-[39%] z-30 sm:left-[18%] sm:top-[38%]"
                  showTitle={false}
                >
                  <DpadControls
                    controls={DPAD_CONTROLS}
                    pressedCodes={pressedCodes}
                    onPress={press}
                    onRelease={release}
                    className="h-24 w-24 sm:h-28 sm:w-28"
                  />
                </ControlCluster>

                <div className="absolute left-1/2 top-[58%] z-30 -translate-x-1/2 sm:top-[57%]">
                  <AnalogStick
                    leftControl={stickLeft}
                    rightControl={stickRight}
                    axisX={state.analogX}
                    pressedCodes={pressedCodes}
                    onPress={press}
                    onRelease={release}
                  />
                </div>

                <div className="absolute left-1/2 top-[43%] z-30 -translate-x-1/2 sm:top-[42%]">
                  <ControlButton
                    control={startControl}
                    pressed={isControlPressed(startControl, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="start"
                  />
                </div>

                <div className="absolute left-1/2 top-[70%] z-30 w-20 -translate-x-1/2 sm:top-[70%] sm:w-24">
                  <ControlButton
                    control={zControl}
                    pressed={isControlPressed(zControl, pressedCodes)}
                    onPress={press}
                    onRelease={release}
                    variant="z"
                    className="w-full"
                  />
                </div>

                <ControlCluster
                  title="A / B"
                  className="absolute right-[22%] top-[50%] z-30 h-24 w-28 sm:right-[23%] sm:top-[49%] sm:h-28 sm:w-32"
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

                <ControlCluster
                  title="C-buttons"
                  className="absolute right-[7%] top-[37%] z-30 sm:right-[8%] sm:top-[36%]"
                  showTitle={false}
                >
                  <DpadControls
                    controls={C_CONTROLS}
                    pressedCodes={pressedCodes}
                    onPress={press}
                    onRelease={release}
                    variant="c"
                    className="h-24 w-24 sm:h-28 sm:w-28"
                  />
                </ControlCluster>

                <div className="absolute bottom-0 left-1/2 z-30 w-[min(92%,24rem)] -translate-x-1/2 rounded-2xl border border-zinc-800 bg-black/40 p-3 shadow-xl shadow-black/30 backdrop-blur">
                  <p className="mb-2 text-center text-xs font-black uppercase tracking-[0.18em] text-zinc-500">
                    Pressed
                  </p>
                  <div className="flex min-h-8 flex-wrap justify-center gap-1.5">
                    {activeButtons.length === 0 && state.analogX === 0 ? (
                      <span className="text-sm text-zinc-600">none</span>
                    ) : (
                      <>
                        {state.analogX < 0 ? (
                          <InputPill label="Stick ←" />
                        ) : null}
                        {state.analogX > 0 ? (
                          <InputPill label="Stick →" />
                        ) : null}
                        {activeButtons.map((label) => (
                          <InputPill key={label} label={label} />
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <aside className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4">
              <div className="space-y-4">
                <div>
                  <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-zinc-400">
                    Mapping
                  </h2>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
                    <MappingTerm label="Stick" value="A / D" />
                    <MappingTerm label="D-pad" value="Arrow keys" />
                    <MappingTerm label="A" value="W / Space" />
                    <MappingTerm label="B" value="S" />
                    <MappingTerm label="Start" value="Enter / P" />
                    <MappingTerm label="Z" value="E / Z" />
                    <MappingTerm label="L / R" value="Q / Shift" />
                    <MappingTerm label="C" value="I J K L" />
                  </dl>
                </div>
                <div className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-100">
                  {hasSeat
                    ? "Your inputs are being sent to the game."
                    : "Claim a player slot when you are ready. Controls still light up here for testing."}
                </div>
              </div>
            </aside>
          </section>
        </main>
      </Container>
    </div>
  );
}
