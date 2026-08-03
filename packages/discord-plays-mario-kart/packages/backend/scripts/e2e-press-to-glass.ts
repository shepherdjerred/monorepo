#!/usr/bin/env bun
// Press-to-glass input driver: the input half of the real input-lag ruler
// (2026-08-03 latency plan).
//
// Every other ruler in this repo measures the VIDEO path — how long a frame
// takes to reach a viewer. That is not input lag. This drives actual controller
// input over the same socket.io path the web frontend uses, claiming a real
// seat and issuing press/release edges with the exact epoch-ms of each emit.
//
// The other half is read off the stream itself: the burned-in HUD lights seat
// N's digit on the first frame the emulator rendered while holding that seat's
// input (see stream/overlay.ts `drawHudOverlay`), and carries the pod's capture
// timestamp. Decoding the HUD out of the Discord viewer's <video> element on
// every presented frame and joining against this log gives, per press:
//
//   press -> on screen  = frame's expected display time - emit time
//
// Both ends of that subtraction are this machine's clock, so it needs no
// clock-skew correction; only the finer decomposition into input path vs video
// path does.
//
// Usage:
//   bun run scripts/e2e-press-to-glass.ts --out <path> [--presses 20]
//     [--hold-ms 400] [--gap-ms 1600] [--button a] [--url https://host]
//   MK_URL env sets the default controller URL.
//
// Not a CI test: it needs a live session with a free seat.
import { io } from "socket.io-client";
import {
  ButtonStateSchema,
  EMPTY_BUTTONS,
  SeatResponseSchema,
} from "@discord-plays-mario-kart/common";

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv.at(i + 1);
  if (v === undefined || v.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return v;
}

function numberArg(name: string, fallback: number): number {
  const raw = argValue(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got ${raw}`);
  }
  return value;
}

const out = argValue("--out");
if (out === undefined) throw new Error("--out <path> is required");
const presses = numberArg("--presses", 20);
const holdMs = numberArg("--hold-ms", 400);
const gapMs = numberArg("--gap-ms", 1600);
const button = argValue("--button") ?? "a";
const url =
  argValue("--url") ?? Bun.env["MK_URL"] ?? "https://mariokart.sjer.red";

const parsedButton = ButtonStateSchema.keyof().safeParse(button);
if (!parsedButton.success) {
  throw new Error(
    `--button must be one of ${Object.keys(EMPTY_BUTTONS).join(", ")}, got ${button}`,
  );
}

// The HUD digit tracks "any control held", so a single button is enough to
// mark the frame; holding it does not depend on the game being in a race.
const idle = { buttons: EMPTY_BUTTONS, analogX: 0, analogY: 0 };
const down = {
  buttons: { ...EMPTY_BUTTONS, [parsedButton.data]: true },
  analogX: 0,
  analogY: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const socket = io(url, { transports: ["websocket"] });

const seat = await new Promise<number>((resolve, reject) => {
  const timer = setTimeout(() => {
    reject(new Error("no seat response within 20s"));
  }, 20_000);
  socket.on("response", (response: unknown) => {
    // The server also broadcasts seat-occupancy ("seats") on this event; only
    // the per-socket seat assignment parses as a SeatResponse.
    const parsed = SeatResponseSchema.safeParse(response);
    if (!parsed.success) return;
    clearTimeout(timer);
    const claimed = parsed.data.value.seat;
    if (claimed === null) {
      // Seats are full. Waiting out the timeout would just obscure the reason.
      reject(new Error("seat claim refused: all seats occupied"));
      return;
    }
    resolve(claimed);
  });
  socket.on("connect", () => {
    socket.emit("request", { kind: "seat-claim" });
  });
  socket.on("connect_error", (error: Error) => {
    clearTimeout(timer);
    reject(new Error(`connect_error: ${error.message}`));
  });
});

console.error(`[press-to-glass] connected to ${url}, seat ${String(seat)}`);

// Socket round trip, so the analysis can attribute the network share of the
// input path without assuming it.
const rtts: number[] = [];
for (let i = 0; i < 10; i++) {
  const start = performance.now();
  await new Promise<void>((resolve) => {
    socket.emit("ping", () => {
      resolve();
    });
  });
  rtts.push(performance.now() - start);
  await sleep(50);
}

// Let the seat claim settle so the first press is not racing it.
await sleep(800);

const events: { pressAt: number; releaseAt: number }[] = [];
for (let i = 0; i < presses; i++) {
  const pressAt = Date.now();
  socket.emit("request", { kind: "input", seat, state: down });
  await sleep(holdMs);
  const releaseAt = Date.now();
  socket.emit("request", { kind: "input", seat, state: idle });
  events.push({ pressAt, releaseAt });
  console.error(`[press-to-glass] press ${String(i + 1)}/${String(presses)}`);
  await sleep(gapMs);
}

socket.emit("request", { kind: "seat-release" });
await sleep(300);
socket.close();

await Bun.write(
  out,
  JSON.stringify({ seat, button, holdMs, gapMs, rtts, events }, null, 1),
);
console.error(
  `[press-to-glass] wrote ${out} (${String(events.length)} presses)`,
);
