import { useCallback, useEffect, useRef, useState } from "react";
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
import { KEYMAP, PADS, computeState } from "./input-map.ts";
import { NameEntry } from "./name-entry.tsx";
import { Leaderboard } from "./leaderboard.tsx";

export function App() {
  const [seat, setSeat] = useState<number | null>(null);
  const [occupied, setOccupied] = useState<boolean[]>([]);
  const [names, setNames] = useState<(string | null)[]>([]);
  const [latency, setLatency] = useState<number>();
  const pressed = useRef<Set<string>>(new Set());
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
        setNames(response.value.names);
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
              const playerName = names[i] ?? null;
              const label = mine
                ? " (you)"
                : playerName === null
                  ? taken
                    ? " (taken)"
                    : ""
                  : ` — ${playerName}`;
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
                  {label}
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
              <NameEntry seat={seat} />
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

          <Leaderboard />
        </div>
      </Container>
    </div>
  );
}
